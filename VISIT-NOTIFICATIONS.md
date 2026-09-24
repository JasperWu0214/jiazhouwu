# Netlify 新访问邮件提醒

程序已接入 `index.html`，由浏览器调用 Netlify Function，再通过 Resend 发送邮件。
不需要让电脑一直开机，也不需要轮询 Netlify 控制台。

## 启用

已确认收件邮箱为 `jasperwu0214@gmail.com`。程序默认使用该邮箱、`https://jiazhouwu.netlify.app` 和 Resend 测试发件人；最少只需在 Netlify 添加 `RESEND_API_KEY`。其余变量可覆盖默认值。使用测试发件人时，请用该 Gmail 注册 Resend。

1. 在 [Resend](https://resend.com/api-keys) 创建仅有发送权限的 API key。
2. 在这个网站的 Netlify → Project configuration → Environment variables 添加以下变量，确保作用域包含 **Functions**、上下文包含 **Production**：

   | 变量 | 内容 |
   | --- | --- |
   | `RESEND_API_KEY` | Resend 发信密钥，只存服务器环境变量 |
   | `VISIT_NOTIFY_TO` | `jasperwu0214@gmail.com` |
   | `VISIT_NOTIFY_FROM` | 已验证域名的发件人，例如 `Website <visits@your-domain.com>` |
   | `VISIT_SITE_URL` | 已关联网站：`https://jiazhouwu.netlify.app`；若使用自定义主域名则改为主域名 |
   | `VISIT_NOTIFICATIONS_ENABLED` | `true`；设置为 `false` 可关闭 |

   Resend 的 `onboarding@resend.dev` 测试发件人只能向注册 Resend 账号的邮箱发信。若收件邮箱不是注册邮箱，先验证自己的域名，再设置发件人。[Resend 限制说明](https://resend.com/docs/api-reference/errors)

3. 在当前 `deploy` 文件夹运行 `npm test`、`npm run build`。无需安装应用依赖，要求 Node.js 22 或以上。
4. 通过原网站的 Git 部署流程发布，或在已经关联原站点的当前目录执行 `netlify deploy --build --prod`。`netlify.toml` 会构建到 `public/`，并打包 `netlify/functions/`。不要仅把静态文件拖到 Netlify Drop，否则不能部署函数。
5. 用无痕窗口打开 `VISIT_SITE_URL` 对应的网站。检查收件箱和垃圾箱；浏览器请求 `/api/visit-notify` 应返回 204。再次刷新不应重复收到邮件。还要在 Netlify 部署日志确认限流规则生效。

环境变量修改后请重新部署。本站现在以 `public/` 为发布目录；服务器代码、说明、测试和环境变量文件不进入公开目录，原有两个未打码 IELTS 图片继续排除。

## 提醒规则

- 页面变为可见时上报一次。每个浏览器从首次上报起 30 分钟内通常只发一封邮件；过期后的下一次打开或重新激活页面可再次提醒。这表示一次浏览器访问窗口，不是永久识别一个新的人。
- 浏览器 localStorage、服务器签名 Cookie 去重；支持 Web Locks 的浏览器还会串行处理多标签页。关闭存储或旧浏览器的并发访问可能多提醒。
- 邮件包含北京时间、访问路径、来源域名。不会发送 IP、完整来源链接、查询参数或浏览器指纹。
- 预览部署、常见爬虫、本地非 HTTPS 访问跳过。没有 JavaScript、被拦截的请求、直接下载文件等不会触发，所以数量不会等于 Netlify Analytics。
- 失败最多尝试 3 次，并在刷新或网络恢复时重试未确认事件；Resend 使用相同幂等键避免重试重复投递。持续故障超过 30 分钟的访问不会补发，没有持久化邮件队列。
- `/api/visit-notify` 每 IP、每域名每分钟限制 5 次请求。来源校验和限流降低滥用；它是公开接口，不能保证每个上报都来自真人。限流不是全站发信总额上限。

## 排除自己的浏览器

在自己网站的浏览器控制台执行，然后刷新：

```js
localStorage.setItem('visit-notify-disabled', '1');
```

恢复：`localStorage.removeItem('visit-notify-disabled')`。测试时用无痕窗口，避免已有的 30 分钟去重状态。

## 故障排查

- 503：缺少变量，或 `VISIT_SITE_URL` 不是 HTTPS URL。
- 403：访问的域名与 `VISIT_SITE_URL` 不一致；使用正式主域名（包括是否有 `www`）。
- 502：在 Netlify Function 日志检查邮件服务状态，再到 Resend 检查密钥、发件域名、收件限制或额度。
- 429：接口限流，等待一分钟后重试。
- 204 代表接口处理完成，也可能因为去重、关闭提醒或过滤而跳过；实际投递请看 Resend 邮件日志。

参考：[Netlify Functions](https://docs.netlify.com/build/functions/api/)、[Netlify 限流](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)、[Resend 24 小时幂等键](https://resend.com/docs/dashboard/emails/idempotency-keys)。
