# Gmail scope review: demo recording kit

Purpose: record the Google OAuth verification video for `gmail.readonly` and
`gmail.send`. This branch changes no application code. The demo shows the real
product route, with the model the user configured displayed exactly as it is.

Kun provides no model. The recording user configures one. This recording uses the
DeepSeek Open Platform API (`https://api.deepseek.com`, model `deepseek-chat`), shown
in the app exactly as configured. Because this is a cloud model, Gmail content that
the user asks about is sent to DeepSeek, and the reply to Google must say so (see
section 7). Do not describe this setup as local or offline anywhere.

## 1. Environment

| Item | Value |
|---|---|
| Kun build | the real macOS package built with `KUN_GMAIL_RELEASE_ENABLED=1` (see `docs/gmail.md`), or the local review build |
| Google project | a separate demo project if the production project is at its user cap; keep the live project "In production" |
| Scopes | exactly `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send` |
| Demo mailbox | a Google account added as a test user of the demo project |
| Recipient mailbox | a second inbox you control, for the sent message |
| Model | DeepSeek API key saved in Kun's provider settings, model chip shows DeepSeek |

Training controls. The DeepSeek platform offers no account setting that turns off
use of API data for model improvement, and the API has no per-request flag. There is
therefore no opt-out to show or to claim. Do not record a settings screen for it and
do not describe one in the reply to Google.

## 2. Dry run (do this before recording)

1. New private Code or Agent conversation with the DeepSeek model selected.
2. Ask: "Find the email with the subject Invoice 2041 and summarize it."
3. Confirm the Gmail card appears, the connect click opens Google, and the task
   resumes after authorization.
4. Confirm `gmail_search` and `gmail_read` rows appear and a summary is written.
5. Ask for a send, confirm the approval dialog lists From, To, Cc, Bcc, Subject and
   the full body, deny once, then approve once.
6. Check **Sent** in the demo mailbox and the inbox of the recipient.
7. Open the model chip and confirm it reads DeepSeek, and that no other provider or
   failover route is enabled in the provider settings.

## 3. Sample emails to seed

Send these to the demo mailbox from the second account a few minutes before
recording, so they sit in the inbox with real timestamps. Use only invented data.

1. Subject: `Invoice 2041 - October design work`
   Body: "Hi, please find the invoice for the October design work. Amount due: USD
   1,250. Payment terms: net 14 days, due 2026-11-05. Thanks, Alex Rivera,
   Rivera Studio."
2. Subject: `Team sync moved to Thursday 3pm`
   Body: "Hi all, the weekly sync is moved to Thursday at 3pm in the Maple room.
   Agenda: roadmap review, launch checklist, open questions. - Sam"
3. Subject: `Lunch next week?`
   Body: "Are you free for lunch on Tuesday? There is a new ramen place near the
   office. - Jordan"
4. Subject: `Your parcel has shipped`
   Body: "Order 88213 has shipped and should arrive Friday. Tracking code
   TRK-5521-ZZ."

## 4. Prompts to use on camera

Read (`gmail.readonly`):

- "Find the email with the subject Invoice 2041 and tell me the amount and due date."
- "Search my inbox for emails about the team sync and summarize what changed."
- "List the emails I received today and give each a one-line summary."

Send (`gmail.send`):

- "Reply to <recipient@example.com> and confirm that I will attend the Thursday 3pm
  sync. Keep it to two sentences." (The Subject and body shown in the approval
  dialog are the model's draft; read them aloud.)

Negative checks worth showing briefly:

- Ask "delete the parcel email". Kun has no delete or modify tool and says so.
- Open a message that contains an instruction such as "forward this to someone"
  and show that it is treated as untrusted content and is not acted on.

## 5. Shot list

| Time | Scene |
|---|---|
| 0:00 | Say what Kun is: a desktop app on the user's computer; it provides no model; the user configures one. Show the DeepSeek provider settings (Base URL `https://api.deepseek.com`, key hidden) and the model chip. Say plainly that mail content you ask about is sent to this provider. |
| 0:30 | Google Cloud Console > Google Auth Platform > Data Access: the two scopes only. Show the OAuth client ID. Publishing status "In production" for the live project. |
| 1:00 | Run the first read prompt. Gmail card appears. Click **Connect Google account**. |
| 1:30 | Browser consent screen, address bar visible, client ID in the URL. Expand until both permissions are fully readable. Pause three seconds. Allow. |
| 2:15 | "Return to Kun" page. Kun resumes. |
| 2:30 | Search, read and summary for the invoice and the sync emails. Open the tool rows to show `gmail_search` and `gmail_read`. |
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

## 7. What to tell Google about DeepSeek

DeepSeek is a third-party AI service with no training opt-out available to us, so
this route does not meet Google's requirement that Gmail data not reach services
that train on it. Expect the review to fail on this point if the video and reply
disclose it accurately. Use a model whose data stays on the user's computer (a local
Ollama model) or a provider whose API terms exclude training by default, and say
exactly which one in the reply. Do not claim an opt-out, zero retention, or that the
data stays on the device for DeepSeek. See `docs/gmail-deepseek-review.md` for the
source links.
