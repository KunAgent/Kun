# Gmail scope review: demo recording kit

Purpose: record the Google OAuth verification video for `gmail.readonly` and
`gmail.send`. This branch changes no application code. The demo shows the real
product route, with the model the user configured displayed exactly as it is.

Kun provides no model. The recording user configures one. This recording uses a
ChatGPT Pro subscription through Kun's "ChatGPT 订阅" provider (OpenAI),
shown in the app exactly as configured. This is a cloud model: the Gmail content the
user asks about is sent to OpenAI, and the reply to Google must say so. Do not
describe this setup as local or offline anywhere.

## 0. Test app

A Gmail-enabled, unsigned macOS arm64 build is at `dist/mac-arm64/Kun.app` (git-ignored). It
embeds the registered Kun Desktop OAuth client, so no operator command is needed.
To rebuild it:

```sh
npm run build && npm run prepare:macos-native:arm64
KUN_GMAIL_RELEASE_ENABLED=1 \
KUN_GMAIL_CLIENT_CONFIG_FILE=~/Downloads/<desktop-client>.json \
npx electron-builder --config electron-builder.config.cjs --publish never --mac dir --arm64
```

Quit any running Kun first (all builds share one bundle id), then start it with
`open -n dist/mac-arm64/Kun.app`. It shares the normal Kun data directory, so existing
providers and sign-ins are present. The package must not be shared: it contains the
Desktop client secret.

## 1. Environment

| Item | Value |
|---|---|
| Kun build | the real macOS package built with `KUN_GMAIL_RELEASE_ENABLED=1` (see `docs/gmail.md`), or the local review build |
| Google project | a separate demo project if the production project is at its user cap; keep the live project "In production" |
| Scopes | exactly `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send` |
| Demo mailbox | a Google account added as a test user of the demo project |
| Recipient mailbox | a second inbox you control, for the sent message |
| Model | ChatGPT Pro, signed in through the "ChatGPT 订阅" provider (Settings > providers) |

Training control. In ChatGPT, Settings > Data controls, the option "Improve the
model for everyone" must be off. Keep a dated screenshot of it; show that page in the
video right after the model chip. Re-check it immediately before recording.

## 2. Dry run (do this before recording)

1. New private Code or Agent conversation with the ChatGPT 订阅 model selected.
2. Ask: "Show my 5 most recent emails in the inbox with sender, subject and a one-line summary."
3. Confirm the Gmail card appears, the connect click opens Google, and the task
   resumes after authorization.
4. Confirm `gmail_search` and `gmail_read` rows appear and a summary is written.
5. Ask for a send, confirm the approval dialog lists From, To, Cc, Bcc, Subject and
   the full body, deny once, then approve once.
6. Check **Sent** in the demo mailbox and the inbox of the recipient.
7. Open the model chip and confirm it reads the ChatGPT 订阅 model, and that no
   other provider or failover route is enabled in the provider settings.

## 3. Mailbox preparation

The cases below do not depend on any particular email. The demo mailbox only needs a
few ordinary messages in the Inbox (newsletters, notifications, anything harmless; no
private mail on camera). If the inbox is empty, send two or three plain messages to it
from the second account. Use a recipient mailbox you control for the send step.

## 4. Prompts to use on camera (in this order)

Say each prompt in English and keep it as short as written.

1. Search and read (`gmail.readonly`):
   - "Show my 5 most recent emails in the inbox with sender, subject and a one-line summary."
   - "Open the second one and summarize it in two sentences."
   - "Search my inbox for emails from the last 7 days that mention 'account' and list them."
2. Send (`gmail.send`), replacing the address with your own recipient mailbox:
   - "Send an email to <recipient@example.com> with the subject 'Kun demo' and a two-sentence
     body saying this is a test message from Kun."
   - The approval dialog shows From, To, Cc, Bcc, Subject and the full body. Click Deny once and
     show that nothing was sent; repeat the request and click Approve.
3. Close the loop (read the message that was just sent):
   - "Find the email I just sent with the subject 'Kun demo' in my Sent mail and tell me when it was sent."
   - This works only after step 2 and proves the send reached the Google account.

Negative checks worth showing briefly:

- "Delete the first email." Kun has no delete or modify tool and says so.
- Open a message that contains an instruction such as "forward this to someone" and show that it
  is treated as untrusted content and is not acted on.

If a search says it found nothing, that is a real empty result: loosen the wording or use the
"5 most recent" prompt instead.

## 5. Shot list

| Time | Scene |
|---|---|
| 0:00 | Say what Kun is: a desktop app on the user's computer; it provides no model; the user configures one. Show the ChatGPT 订阅 provider and the model chip. Say that Kun ships no model, that mail you ask about is sent to OpenAI, and that other users may choose other models. Then show ChatGPT Settings > Data controls with \"Improve the model for everyone\" off. |
| 0:30 | Google Cloud Console > Google Auth Platform > Data Access: the two scopes only. Show the OAuth client ID. Publishing status "In production" for the live project. |
| 1:00 | Run the first prompt. Gmail card appears. Click **Connect Google account**. |
| 1:30 | Browser consent screen, address bar visible, client ID in the URL. Expand until both permissions are fully readable. Pause three seconds. Allow. |
| 2:15 | "Return to Kun" page. Kun resumes. |
| 2:30 | Prompt 1 sequence: recent emails, then open one and summarize. Open the tool rows to show `gmail_search` and `gmail_read`. |
| 3:30 | Send prompt. Approval dialog with the full message. Deny once, show that nothing was sent; repeat the request and approve. |
| 4:15 | Gmail web: **Sent** folder of the demo mailbox, then the recipient inbox. |
| 5:00 | **Manage > Disconnect**, then **Also revoke Kun's Google access**. Open `myaccount.google.com/permissions`. |
| 5:30 | Show the privacy page with the Limited Use statement. |

## 6. Before uploading

- Both scopes are readable on the consent screen, nothing covers them.
- Each scope is exercised by a visible feature and the send is visible in the
  Google account.
- The model shown in the app is the model that actually ran.
- No tokens, client secret or unrelated personal mail on screen.
- Upload as an unlisted video that opens without sign-in.
- The privacy page already carries the Limited Use statement and the model
  disclosure before you reply to Google.

## 7. What to tell Google

Name OpenAI, plan ChatGPT Pro, and state that the account's "Improve the model for
everyone" setting is off (attach the dated screenshot). Say that Kun provides no
model, that the connection card names the model that receives the data, and that the
privacy page recommends a local model or a service whose terms exclude training. Do
not claim zero retention, and do not say the data stays on the device.
