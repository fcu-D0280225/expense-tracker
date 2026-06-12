
## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

## AI 部署規範（強制）

若要透過 AI 部署本專案（ssh、`pm2 reload`、`deploy.sh`、`redeploy.sh` 等讓 VPS 生效的動作），**請到 HQ repo `mine/alley-menagerie` 開 session，呼叫 HQ 的 `devops-agent` 執行**——他是唯一可讓 VPS 生效的員工。在本 repo 開的 AI 不得自行 ssh / pm2 reload。

- 測試環境（`34.81.71.192`）：devops-agent 可直接部署，免每次徵求同意
- 正式環境：devops-agent 須先通知 jacksonlin 並取得**明確同意**
- 政策 SSOT：`mine/alley-menagerie/ops/policy.yaml`、`mine/alley-menagerie/ops/deploy-matrix.yaml`
