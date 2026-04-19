'use strict';
const { messagingApi, validateSignature } = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

const anthropic = new Anthropic();

function getLineClient() {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  });
}

async function parseWithClaude(text, categories, accounts) {
  const today = new Date().toISOString().slice(0, 10);

  const categoryList = categories.map(c => {
    const subs = c.subcategories.length > 0
      ? `（小分類：${c.subcategories.map(s => s.name).join('、')}）`
      : '';
    return `${c.name}${subs}`;
  }).join('、');

  const assetAccounts = accounts.filter(a => a.type === 'asset').map(a => a.name).join('、');
  const expenseAccounts = accounts.filter(a => a.type === 'expense').map(a => a.name).join('、');

  const systemPrompt = `你是記帳助手，解析使用者的自然語言訊息成結構化 JSON。

今天：${today}
可用分類：${categoryList}
資產帳戶：${assetAccounts}
支出帳戶：${expenseAccounts}

規則：
- 金額必填，無法判斷則回傳 {"error":"..."}
- 分類從可用分類中 fuzzy match，選最接近的
- 未指定來源帳戶 → 預設「現金」
- 未指定日期 → 今天 ${today}
- 相對日期（昨天、前天、上週等）請自行換算成 YYYY-MM-DD
- dest_account 選對應分類的支出帳戶（飲食→飲食、交通→交通、購物→購物）
- type 固定為 "expense"

回傳嚴格 JSON（不要有其他文字）：
{"amount":數字,"description":"說明文字","category":"大分類名稱","subcategory":"小分類名稱或null","source_account":"來源帳戶名稱","dest_account":"目的帳戶名稱","date":"YYYY-MM-DD","type":"expense"}`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: text }],
  });

  return JSON.parse(msg.content[0].text.trim());
}

async function handleLineWebhook(req, res) {
  const signature = req.headers['x-line-signature'];
  if (!signature || !validateSignature(req.rawBody, process.env.LINE_CHANNEL_SECRET, signature)) {
    return res.status(401).send('Invalid signature');
  }

  // Respond to LINE immediately to avoid timeout
  res.status(200).send('OK');

  const events = req.body.events || [];
  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const { replyToken } = event;
    const userText = event.message.text.trim();
    const client = getLineClient();

    try {
      const [catRows, subRows, accounts] = await Promise.all([
        db.query('SELECT * FROM categories ORDER BY id'),
        db.query('SELECT * FROM subcategories ORDER BY id'),
        db.query('SELECT * FROM accounts ORDER BY type, id'),
      ]);

      const categories = catRows.map(c => ({
        ...c,
        subcategories: subRows.filter(s => s.category_id === c.id),
      }));

      let parsed;
      try {
        parsed = await parseWithClaude(userText, categories, accounts);
      } catch (_) {
        parsed = { error: '解析失敗' };
      }

      if (parsed.error) {
        await client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `抱歉，無法理解這筆記錄。\n請試試「午餐 250」或「昨天搭計程車花了三百五」這樣的格式`,
          }],
        });
        continue;
      }

      // Resolve account rows
      const srcAccount = accounts.find(a => a.name === parsed.source_account && a.type === 'asset')
        || accounts.find(a => a.name === '現金' && a.type === 'asset');
      const destAccount = accounts.find(a => a.name === parsed.dest_account && a.type === 'expense')
        || accounts.find(a => a.name === parsed.category && a.type === 'expense')
        || accounts.find(a => a.type === 'expense');

      if (!srcAccount || !destAccount) {
        await client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: '系統錯誤：找不到對應帳戶，請稍後再試' }],
        });
        continue;
      }

      // Resolve category & subcategory IDs
      const category = categories.find(c => c.name === parsed.category);
      const subcategory = category?.subcategories.find(s => s.name === parsed.subcategory);

      await db.run(`
        INSERT INTO transactions
          (description, date, amount, source_account_id, dest_account_id,
           category_id, subcategory_id, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        parsed.description || null,
        parsed.date,
        parsed.amount,
        srcAccount.id,
        destAccount.id,
        category?.id || null,
        subcategory?.id || null,
        'LINE 記帳',
      ]);

      const catIcon = category?.icon ? ` ${category.icon}` : '';
      const subStr = parsed.subcategory ? ` / ${parsed.subcategory}` : '';
      await client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `✅ 已記錄${catIcon}\n💰 NT$ ${parsed.amount}\n📂 ${parsed.category || '—'}${subStr}\n💳 ${srcAccount.name}\n📅 ${parsed.date}${parsed.description ? '\n📝 ' + parsed.description : ''}`,
        }],
      });
    } catch (err) {
      console.error('[LINE webhook error]', err);
      try {
        await getLineClient().replyMessage({
          replyToken,
          messages: [{ type: 'text', text: '系統發生錯誤，請稍後再試' }],
        });
      } catch (_) {}
    }
  }
}

module.exports = { handleLineWebhook };
