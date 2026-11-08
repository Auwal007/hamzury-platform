# recommendations: a calm, understood, directed client experience

hamzury holding / platform v5 / 5 november 2026

## the goal

every client should be able to answer three questions at any moment, without asking anyone:

1. **where am i?** (which stage of awareness, strategy, structure, systems, success)
2. **what is happening?** (who is working on what, and whether anything is in the way)
3. **what do i do next?** (one clear action, or "nothing, we will update you")

when a client can answer these, they feel calm. when we reuse what they already told us, they feel understood. when every message ends with one next step, they feel directed. everything below is built around that.

---

## part 1. the journey now built (version 4)

one path for every client, one screen at a time:

1. **home:** a short hook on what we do, then two doors: **start here** (new) and **track my progress** (hamzury id + phone number).
2. **start here:** 12 simple questions, one per screen, contact details last. the client gets a **hamzury id** straight away.
3. **holding prepares the recommendation** in the desk: reads the answers, picks packages from the **catalogue**, marks each essential, recommended or optional, sets the roadmap stage, the fee and a note on why it fits, then publishes.
4. **the client sees the recommendation:** what we heard, what we recommend, and the packages grouped by roadmap stage, each with its fee. tapping a package shows what is inside, the value, the duration and the fee.
5. **the client chooses only what they want.** the total grows as they select. checkout by paystack (when keys are set) or bank transfer, which holding confirms.
6. **onboarding** asks only the questions for the packages they paid for.
7. **progress:** each paid package shows its status and a progress bar until delivery, then a download button. unpaid packages stay locked, with "see and add".
8. **updates** (progress, blocker, next step) appear on the dashboard and come with ready whatsapp text.

**added in version 5**

- **venture pages** in each venture's colours with its services, "start here with [venture]" and, where confirmed, "explore the [venture] site". every enquiry still lands at the holding desk, tagged with the venture.
- **ventures report, holding speaks.** holding assigns paid packages to venture staff with a brief and due date. ventures do the work and send reports. holding publishes to the client or returns with a note.
- **questions that help people see their own situation:** what they tried, what would change, how important it is now, short reflections of their own words, and a clarity snapshot before contact details.
- **build your plan:** the recommendation opens with "you told us", and the client chooses.
- **locked next steps:** the progress view shows the whole roadmap. after each delivery, the next locked step is offered with an unlock button.

a note on persuasion: the strongest and most durable persuasion here is the client hearing their own words and choosing freely from a clear plan. keep the recommendation clearly labelled as yours, never invent results, numbers or deadlines, and never hide fees. that keeps the brand promise and brings clients back for the next package.

why this feels calm, understood and directed: one question per screen, nothing asked twice, every fee visible before paying, one next step on the dashboard at all times, and a progress view that answers "where is my work?" without a message.

## part 2. what to decide before launch

these are decisions only leadership can make. the platform currently uses a sensible default for each.

1. **recommendation time.** new clients are told their recommendation appears "usually within 48 hours". confirm this, or change `HAMZURY_UPDATE_HOURS`. only promise what the desk can meet every week.
2. **the catalogue and fees.** enter your approved packages, what is inside, durations and fees. the sample catalogue is for testing only.
3. **payments.** add paystack keys for online payment, and your bank details for transfers. decide who confirms transfers each day.
4. **who owns the desk each day.** name one desk lead per day (a simple rota). the calm feeling breaks the first time an enquiry waits three days because everyone thought someone else had it.
5. **a public whatsapp number.** the brand standard lists desk@hamzury.com but no number, so the site offers whatsapp only as a reply channel. once a verified whatsapp business number exists, add a "message us on whatsapp" link.
6. **domains.** the brand standard asks you to confirm whether "medialty.hamzury.com" is the intended spelling. the footer leaves medialy's address out until it is confirmed. subt and iotics addresses are listed as proposed only, so they are not shown.
7. **logos.** the logos were taken from the brand standard pdf. replace them with the master vector files when available. subt, iotics, hub and iwiin marks are still "concepts for review" in the standard.
8. **privacy note.** a plain-language privacy note is live at `/privacy`. have it reviewed against the nigeria data protection act 2023 before real client data is collected, and decide how long enquiries and closed client records are kept.

---

## part 3. recommended next steps, in order

### now (before going live)

- **host it properly.** a verified domain with https, `HAMZURY_SECURE_COOKIES=1`, `HAMZURY_PUBLIC_BASE_URL` set, daily database backups and a tested restore. links made on a laptop will not open on a client's phone.
- **set up whatsapp business (the free app is enough to start).** use a greeting message that mirrors the five welcome options, quick replies for the update format (progress, blocker, next step) and labels for each roadmap stage. this keeps whatsapp and the desk speaking the same language.
- **staff security.** one account per person, multi-factor sign-in for holding staff, and an external rate limiter in front of the app. these are listed in `docs/production-readiness.md`.
- **a welcome message.** when someone gets a hamzury id, send one short whatsapp message: who their contact is, when their recommendation will be ready, and what you will never ask for.

### next 30 to 60 days

- **clarity check-ins.** at the end of each stage, ask one question: "how clear is your next step, from 1 to 5?" low scores tell you exactly where the experience is confusing.
- **measure calm.** track four numbers weekly: time to first reply, percentage of active clients updated within 48 hours, questions per client (a rising number usually means updates are unclear), and days from recommendation to payment.
- **stronger sign-in.** add a one-time code sent to the client's phone on top of the hamzury id and phone number.
- **client uploads.** delivered files are already downloadable. next, let clients upload documents during onboarding instead of sending them on whatsapp.
- **whatsapp business platform.** once volumes justify it, connect the desk to the whatsapp cloud api so updates and links can be sent from the desk using approved message templates. keep a person reviewing every message.

### later

- **success-stage reviews.** at the success stage, write a short "what changed, what remains, what comes next" summary for the client. with permission, these become honest case studies.
- **client offers.** for each venture, write offers in the brand standard's structure: who it serves, what it solves, inclusions, exclusions, price status, dependencies and next step. publish only verified offers.
- **venture sites.** venture pages are built. once each venture's own domain is confirmed, point its site's main button back to its hamzury venture page, so every client still follows one roadmap.
- **a "next step" message after delivery.** when a package is delivered, send one whatsapp line naming the next locked step on their roadmap and why it follows. no pressure, just the next logical step.

---

## part 4. the operating rhythm that makes it work

software only shows the standard. people keep it. a light rhythm is enough:

- **every morning, 15 minutes (desk lead):** publish recommendations for new clients, confirm transfers, assign new paid packages, review venture reports and publish or return them.
- **ventures, every 48 hours on active work:** send one report to holding, even if the only news is "on track".
- **every update, three parts:** progress, anything holding us back (or "nothing at the moment"), next step with who does it. no update without a next step.
- **every message, one ask:** say what is happening, why it matters and the one thing the client should do. ask only for what is needed at this stage.
- **every friday, 30 minutes (holding leadership):** review active roadmaps, overdue updates, work waiting for quality checks, and the four numbers above.
- **every new staff member:** read `docs/communication-standard.md` and the brand standard's voice page before writing to a client.

---

## what this does not do (on purpose)

it does not send whatsapp messages automatically, sign contracts, estimate prices or let ai talk to clients directly. each of those needs a decision, a policy and testing first. the platform keeps a person in charge of every message a client receives.
