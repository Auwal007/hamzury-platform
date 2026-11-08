"""hamzury master service catalogue: the single source of truth for every service.

one code, one scope, one accountable owner, one price basis, one delivery standard.
- packages (levels) group services. they are not a buying order: any item can be chosen when it is needed.
- prices marked 'proposed' are never shown to clients until the holding approves them in the desk.
- duration rules (holding decision, 6 nov 2026):
    scuml (all categories) 5 days · cac limited company 5 days · cac ngo (incorporated trustees) 30 days · other cac work 14 days
    work we produce ourselves (documents, designs, websites, setups) at most 7 days
    work that waits for an outside approval (trademark, licences, nsitf, pencom, bpp, tin) 14 days
  the clock starts when payment, requirements and any needed approvals are in.
- urgency: 1 = needed now (red), 2 = needed soon (amber), 3 = optional (blue).
"""
import re

LEVEL_NAMES = {'minimum': 'business foundation', 'standard': 'business operations', 'protection': 'business safeguards',
               'scaling': 'business growth', 'renewals': 'business continuity'}
OWNERS = ('holding', 'bizdoc', 'medialy', 'subt', 'iotics', 'hub', 'iwiin', 'finance')
BASIS = ('fixed', 'from', 'monthly', 'session', 'request', 'workflow', 'quote')
FORMATS = ('file', 'document', 'workbook', 'folder', 'bundle', 'workspace', 'website', 'guide', 'service')

GOV = 'government and statutory fees are separate.'
SOFT = 'domains, hosting, paid software and subscriptions are separate.'
ADS = 'advertising spend is separate.'
PRINT = 'printing and physical materials are separate.'
ID_DOC = {'label': "a valid id for each owner or director (nin slip, passport or driver's licence)", 'kind': 'file', 'why': 'the registry asks for proof of identity for every owner.'}
CAC_DOC = {'label': 'your cac certificate or registration documents', 'kind': 'file', 'why': 'we need your registration number and details to prepare the application correctly.'}


def item(code, name, owner, level, value, inclusions, duration, price, basis='fixed', status='proposed', exclusions=(), external='',
         fmt='document', group='', requires=(), overlaps=(), stage='structure', onboarding=(), focus=''):
    return dict(code=code, name=name, owner=owner, level=level, value=value, inclusions=list(inclusions), exclusions=list(exclusions),
                duration=duration, price_minor=int(price) * 100, basis=basis, status=status, external=external, format=fmt, group=group,
                requires=list(requires), overlaps=list(overlaps), stage=stage, onboarding=list(onboarding), focus=focus)


CATALOGUE = [
    # ---------------- minimum · business foundation ----------------
    item('BZ-01', 'cac business name registration', 'bizdoc', 'minimum', 'a registered business identity that customers and institutions can verify.',
         ['review of your details', 'name availability and application', 'preparation and submission', 'handover of issued records'], '14 days', 30000,
         external=GOV, fmt='file', group='cac-registration', stage='structure', focus='registering your business properly',
         onboarding=[{'label': 'three name options, in order of preference', 'kind': 'long', 'why': 'a name can be refused if it is taken, so we check all three in order.'},
                     {'label': 'what will the business do?', 'kind': 'long', 'why': 'the registration needs a clear description of your business activity.'}, ID_DOC,
                     {'label': 'a passport photograph of each owner', 'kind': 'file', 'why': 'the application asks for one for every owner.'}]),
    item('BZ-02', 'cac limited company registration', 'bizdoc', 'minimum', 'a company structure that fits your ownership and plans.',
         ['review of ownership and director details', 'one company application', 'submission support', 'handover of issued documents'], '5 days', 50000,
         external=GOV, fmt='file', group='cac-registration', stage='structure', focus='registering your company properly',
         onboarding=[{'label': 'two company name options', 'kind': 'long', 'why': 'a name can be refused if it is taken.'},
                     {'label': 'directors, shareholders and how shares are split', 'kind': 'long', 'why': 'the company is registered with these exact owners and shares.'}, ID_DOC,
                     {'label': 'company address', 'kind': 'text', 'why': 'every company must have a registered address.'}]),
    item('BZ-16', 'cac incorporated trustees (ngo) registration', 'bizdoc', 'minimum', 'a registered identity for your ngo, foundation or association.',
         ['review of trustees and objectives', 'name application', 'constitution guidance', 'submission and follow-up', 'handover of issued records'], '30 days', 70000,
         external=GOV + ' newspaper publication, where required, is separate.', fmt='file', group='cac-registration', stage='structure',
         focus='registering your organisation properly', onboarding=[ID_DOC, {'label': 'names of at least two trustees and the aims of the organisation', 'kind': 'long', 'why': 'the registration lists the trustees and what the organisation exists to do.'}]),
    item('BZ-03', 'tax identification (tin) support', 'bizdoc', 'minimum', 'the tax identification your business needs for banks, contracts and payments.',
         ['check of your existing status', 'application or correction support', 'handover of available documents'], '14 days', 15000,
         exclusions=['a second registration if you already have a tin'], external=GOV, fmt='file', stage='structure', onboarding=[CAC_DOC]),
    item('BZ-04', 'banking board resolution', 'bizdoc', 'minimum', 'a clear record of who may operate the company bank account.',
         ['one resolution', 'authorised signatories', 'matched to your bank’s requirements'], '2 days', 10000, fmt='document', requires=['BZ-02'],
         onboarding=[{'label': 'the bank and the authorised signatories', 'kind': 'long', 'why': 'the resolution must match the bank’s form and the people who will sign.'}]),
    item('BZ-05', 'scuml assistance: applicable businesses', 'bizdoc', 'minimum', 'help preparing and submitting your scuml application for compliance and banking.',
         ['applicability check', 'requirements review', 'application assistance', 'submission record and follow-up'], '5 days', 60000, status='approved',
         external='scuml registration itself is free. this is bizdoc’s professional assistance fee. certificate issuance is by scuml.', fmt='file',
         group='scuml', onboarding=[CAC_DOC, ID_DOC]),
    item('BZ-06', 'scuml assistance: mining, oil and gas', 'bizdoc', 'minimum', 'your scuml application prepared for the checks your sector faces.',
         ['activity and requirements review', 'application assistance', 'follow-up'], '5 days', 100000, status='approved',
         external='scuml registration itself is free. this is bizdoc’s professional assistance fee. certificate issuance is by scuml.', fmt='file',
         group='scuml', onboarding=[CAC_DOC, ID_DOC]),
    item('BZ-07', 'scuml assistance: ngos, foundations and organisations', 'bizdoc', 'minimum', 'your organisation’s scuml application prepared and submitted.',
         ['applicability review', 'organisational document checks', 'application assistance', 'follow-up'], '5 days', 50000, status='approved',
         external='scuml registration itself is free. this is bizdoc’s professional assistance fee. certificate issuance is by scuml.', fmt='file',
         group='scuml', onboarding=[CAC_DOC, ID_DOC]),
    item('MD-01', 'simple brand kit', 'medialy', 'minimum', 'one consistent identity across your documents and customer channels.',
         ['two logo directions', 'one final logo', 'colours and fonts', 'letterhead', 'profile image', 'short usage guide', 'two revision rounds'], '7 days', 70000,
         fmt='folder', stage='strategy', focus='a brand customers recognise',
         onboarding=[{'label': 'your business name and what it does, in one line', 'kind': 'text', 'why': 'the logo and colours must fit what you sell and who you sell to.'},
                     {'label': 'any logo you use now', 'kind': 'file', 'required': False, 'why': 'we keep what customers already recognise.'}]),
    item('MD-02', 'starter company profile', 'medialy', 'minimum', 'a clear profile that explains your business to customers and partners.',
         ['up to six pages', 'services, audience and contacts', 'verified capabilities only', 'pdf and editable source'], '7 days', 40000, exclusions=[PRINT], fmt='file', stage='strategy'),
    item('MD-03', 'service menu or offer sheet', 'medialy', 'minimum', 'customers see exactly what they can buy and how to order.',
         ['one sheet, up to eight offers', 'inclusions and exclusions', 'ordering instructions'], '3 days', 15000, fmt='file', stage='strategy'),
    item('MD-04', 'customer communication starter kit', 'medialy', 'minimum', 'consistent replies that guide every customer to a clear next step.',
         ['up to ten approved replies', 'enquiries, quotes, payments, progress and follow-up'], '3 days', 20000, fmt='document', stage='strategy', focus='clear replies for every customer question'),
    item('ST-01', 'whatsapp business setup', 'subt', 'minimum', 'your whatsapp becomes an organised place for enquiries.',
         ['profile and hours', 'up to ten catalogue entries', 'labels', 'greeting and away messages', 'up to six supplied quick replies'], '3 days', 25000,
         fmt='service', stage='systems', focus='an organised whatsapp for enquiries'),
    item('ST-02', 'google business profile setup', 'subt', 'minimum', 'customers find accurate information about you on google.',
         ['eligibility review', 'profile, categories, contacts and services', 'verification assistance'], '3 days', 15000,
         external='google’s own verification can take longer and is outside our control.', fmt='service', stage='systems', focus='being found on google'),
    item('ST-03', 'business folder and access setup', 'subt', 'minimum', 'organised files and clear account ownership from day one.',
         ['folder structure', 'naming rules', 'access permissions', 'account register'], '3 days', 15000, fmt='folder', stage='systems'),
    item('ST-04', 'starter business tracker', 'subt', 'minimum', 'enquiries, income, expenses and unpaid balances in one simple place.',
         ['editable workbook', 'agreed fields', 'basic summary', 'sample entries'], '5 days', 20000, fmt='workbook', stage='systems', focus='keeping every order and payment in one place'),
    item('ST-05', 'business email setup', 'subt', 'minimum', 'a professional email on your own domain.',
         ['up to three mailboxes', 'basic signatures', 'access handover'], '3 days', 20000, exclusions=[SOFT], fmt='service', stage='systems'),
    item('HB-01', 'owner quick-start training', 'hub', 'minimum', 'use your new tools confidently in everyday work.',
         ['one remote session up to 90 minutes', 'up to three people', 'quick-start checklist'], 'one session', 20000, basis='session', fmt='guide', stage='systems'),

    # ---------------- standard · business operations ----------------
    item('HH-01', 'business model and direction blueprint', 'holding', 'standard', 'know how your business earns, what it costs and what to do next.',
         ['one discovery session', 'customer and problem summary', 'revenue model and key costs', 'priorities', '90-day roadmap'], '7 days', 50000,
         fmt='file', stage='strategy', focus='a clear direction for the next 90 days'),
    item('HH-02', 'organisational structure and role kit', 'holding', 'standard', 'clear responsibilities, so work never depends on guesswork.',
         ['organisation chart', 'up to six role descriptions', 'reporting lines and decision rights'], '7 days', 60000, fmt='document', stage='structure', focus='clear roles for your team'),
    item('HH-03', 'core sop handbook', 'holding', 'standard', 'clear instructions so work is delivered the same way every time.',
         ['up to six processes', 'owner, steps, records and checks for each'], '7 days', 90000, fmt='document', stage='structure', focus='written steps your team can follow'),
    item('HH-04', 'business routine and review kit', 'holding', 'standard', 'daily, weekly and monthly routines that keep the business on track.',
         ['role checklists', 'review agenda', 'action log', 'up to ten performance measures'], '5 days', 30000, fmt='document', stage='structure'),
    item('MD-05', 'positioning and offer strategy', 'medialy', 'standard', 'who you serve, what you offer and why customers should choose you.',
         ['target audience', 'differentiation', 'up to three offers', 'key messages and sales story'], '7 days', 60000, fmt='document', stage='strategy', focus='a clear reason for customers to choose you'),
    item('MD-06', 'sales process and crm specification', 'medialy', 'standard', 'every enquiry gets a clear path to a decision.',
         ['lead stages', 'qualification questions', 'ownership rules', 'follow-up schedule'], '7 days', 40000, fmt='document', stage='strategy', focus='a sales process that follows up'),
    item('MD-07', 'marketing launch kit', 'medialy', 'standard', 'consistent communication with a clear direction and reusable designs.',
         ['two social profiles set up', 'six post templates', 'content themes', 'one-month calendar'], '7 days', 50000, exclusions=['ongoing posting'], fmt='folder', stage='strategy'),
    item('MD-08', 'sales proposal template', 'medialy', 'standard', 'present your offer and price professionally.',
         ['one reusable proposal up to eight pages', 'editable client, scope and pricing sections'], '5 days', 35000, fmt='document', stage='strategy'),
    item('BZ-08', 'client service agreement', 'bizdoc', 'standard', 'agreed work, payment terms and responsibilities, written before work begins.',
         ['one service agreement', 'requirements discussion', 'one revision'], '7 days', 40000, exclusions=['stamp duty and filing fees'], external='complex legal drafting is quoted after review.', fmt='document',
         stage='structure', focus='an agreement that protects your contract'),
    item('BZ-09', 'worker or contractor agreement', 'bizdoc', 'standard', 'clear expectations for the people who deliver your work.',
         ['one agreement type for one role', 'one revision'], '7 days', 35000, exclusions=['stamp duty and filing fees'], fmt='document', stage='structure', focus='clear terms for the people doing the work'),
    item('BZ-10', 'transaction document kit', 'bizdoc', 'standard', 'consistent quotes, invoices, receipts and sign-offs.',
         ['quotation, invoice, receipt and completion templates'], '5 days', 25000, fmt='document', stage='structure'),
    item('FN-01', 'pricing and costing model', 'finance', 'standard', 'know what each sale costs and the margin your price needs.',
         ['costing for up to ten offers', 'overhead assumptions', 'margin scenarios'], '7 days', 50000, fmt='workbook', stage='structure'),
    item('FN-02', 'financial records setup', 'finance', 'standard', 'one consistent way to record income, expenses and what you are owed.',
         ['account categories', 'record templates', 'monthly reporting structure'], '7 days', 60000, fmt='workbook', stage='structure', focus='records that show where your money goes'),
    item('FN-03', 'budget and cash-flow plan', 'finance', 'standard', 'plan spending and see tight months before they arrive.',
         ['twelve-month workbook', 'your assumptions', 'one review session'], '7 days', 45000, fmt='workbook', stage='structure'),
    item('ST-06', 'business website', 'subt', 'standard', 'one clear place for customers to understand you and get in touch.',
         ['up to five pages', 'mobile layout', 'one enquiry form', 'basic analytics'], '7 days', 180000, exclusions=[SOFT, 'copywriting beyond supplied content'],
         fmt='website', stage='systems', focus='a website customers can reach you through',
         onboarding=[{'label': 'the pages you want and what each should say', 'kind': 'long', 'why': 'we build the pages around your real services.'},
                     {'label': 'your logo and photos', 'kind': 'file', 'why': 'the site uses your own brand and images.'}]),
    item('ST-07', 'crm configuration', 'subt', 'standard', 'customer details and follow-ups organised in one system.',
         ['one pipeline on your existing platform', 'up to five users', 'agreed fields', 'import of up to 100 records', 'testing'], '7 days', 90000, exclusions=[SOFT], fmt='workspace', stage='systems'),
    item('ST-08', 'operations workspace', 'subt', 'standard', 'tasks, deadlines and approvals visible to the right people.',
         ['one workflow', 'up to five users', 'task stages', 'notifications'], '7 days', 90000, exclusions=[SOFT], fmt='workspace', stage='systems'),
    item('ST-09', 'business dashboard', 'subt', 'standard', 'your key numbers without searching through records.',
         ['one dashboard', 'up to eight measures', 'two compatible data sources'], '7 days', 75000, exclusions=['bespoke integrations'], fmt='workspace', overlaps=['ST-07', 'ST-08'], stage='systems'),
    item('ST-10', 'financial tool configuration', 'subt', 'standard', 'your approved record structure turned into a working tool.',
         ['one application or workbook on your existing platform', 'up to two users', 'report testing'], '7 days', 45000, fmt='workbook', overlaps=['FN-02'], stage='systems'),
    item('HB-02', 'team implementation training', 'hub', 'standard', 'your team uses the new processes and tools the same way.',
         ['two remote sessions', 'up to five people', 'exercises and role checklists'], 'within 7 days', 50000, fmt='guide', stage='systems', focus='a team trained on the new way of working'),

    # ---------------- protection · business safeguards ----------------
    item('BZ-11', 'trademark application support', 'bizdoc', 'protection', 'practical steps to protect the name and mark customers know you by.',
         ['requirements review', 'search and application for one mark in one class'], '14 days', 60000, external=GOV + ' registry decisions take longer and are outside our control.',
         fmt='file', stage='structure'),
    item('BZ-12', 'agreement review', 'bizdoc', 'protection', 'find unclear terms before they turn into disputes.',
         ['review of one agreement up to ten pages', 'issue summary', 'agreed revisions'], '7 days', 40000, fmt='document', stage='structure',
         onboarding=[{'label': 'the agreement to review', 'kind': 'file', 'why': 'we review the exact document you will sign.'}]),
    item('BZ-13', 'compliance obligations map', 'bizdoc', 'protection', 'know every obligation your business must track, and who owns it.',
         ['review for one entity, activity and location', 'obligations register', 'evidence list', 'review calendar'], '7 days', 50000, fmt='document', stage='structure',
         focus='knowing exactly which papers and filings apply to you', onboarding=[CAC_DOC]),
    item('BZ-17', 'nsitf compliance certificate support', 'bizdoc', 'protection', 'the nsitf certificate many contracts and tenders ask for.',
         ['requirements check', 'application preparation', 'submission and follow-up'], '14 days', 40000, external=GOV, fmt='file', stage='structure', onboarding=[CAC_DOC]),
    item('BZ-18', 'pencom compliance certificate support', 'bizdoc', 'protection', 'the pencom certificate public and corporate contracts often require.',
         ['requirements check', 'application preparation', 'submission and follow-up'], '14 days', 40000, external=GOV, fmt='file', stage='structure', onboarding=[CAC_DOC]),
    item('BZ-19', 'bpp contractor registration support', 'bizdoc', 'protection', 'registration that lets you bid for public procurement.',
         ['requirements check', 'document preparation', 'portal submission and follow-up'], '14 days', 50000, external=GOV, fmt='file', requires=['BZ-17', 'BZ-18'], stage='structure',
         onboarding=[CAC_DOC, {'label': 'your nsitf, pencom and tax documents, if you have them', 'kind': 'file', 'required': False, 'why': 'registration usually asks for these compliance documents.'}]),
    item('HH-05', 'risk and approval controls kit', 'holding', 'protection', 'less confusion around spending, decisions and problems.',
         ['up to ten priority risks', 'approval matrix', 'escalation steps', 'action register'], '7 days', 45000, fmt='document', stage='structure'),
    item('MD-09', 'brand and communication controls', 'medialy', 'protection', 'public communication stays consistent as more people speak for you.',
         ['brand-use rules', 'content approvals', 'consent workflow', 'complaint-response guidance'], '5 days', 30000, fmt='document', stage='strategy'),
    item('ST-11', 'access and account security setup', 'subt', 'protection', 'the right access for each person, with clear ownership and recovery.',
         ['up to five users across three services', 'permissions review', 'multifactor setup where supported', 'offboarding checklist'], '5 days', 40000, fmt='guide', stage='systems'),
    item('ST-12', 'backup and recovery setup', 'subt', 'protection', 'a tested way to recover when files or access are lost.',
         ['backup for one file store', 'retention settings', 'one restore test', 'recovery guide'], '5 days', 40000, exclusions=[SOFT], fmt='guide', stage='systems'),
    item('ST-13', 'compliance dashboard setup', 'subt', 'protection', 'deadlines, owners and evidence visible in one place.',
         ['dashboard for up to ten obligations', 'reminders', 'evidence links'], '7 days', 45000, fmt='workspace', requires=['BZ-13'], stage='systems'),
    item('HB-03', 'safeguards training', 'hub', 'protection', 'your team follows the access, record and escalation rules.',
         ['one remote session', 'up to five people', 'scenario checklist'], 'one session', 25000, basis='session', fmt='guide', stage='systems'),

    # ---------------- scaling · business growth ----------------
    item('HH-06', 'growth and capacity plan', 'holding', 'scaling', 'connect your growth goals to the people and processes that deliver them.',
         ['ninety-day plan', 'capacity review', 'hiring priorities', 'milestones'], '7 days', 75000, fmt='file', stage='success', focus='a growth plan your team can deliver'),
    item('MD-10', 'corporate sales kit', 'medialy', 'scaling', 'approach larger customers with a credible offer.',
         ['capability presentation, reusing your profile content', 'corporate offer sheet', 'outreach sequence'], '7 days', 60000, fmt='file', stage='strategy'),
    item('MD-11', 'advertising campaign setup', 'medialy', 'scaling', 'one focused campaign with a clear audience, offer and enquiry route.',
         ['one platform, one campaign', 'up to three creative variations from your supplied assets', 'tracking setup'], '7 days', 50000, exclusions=[ADS], fmt='service', stage='strategy'),
    item('MD-12', 'customer retention programme', 'medialy', 'scaling', 'happy customers get a clear reason to buy again and refer others.',
         ['repeat-purchase process', 'referral rules', 'feedback flow', 'up to five message templates'], '7 days', 40000, fmt='document', stage='success'),
    item('IW-01', 'partnership development kit', 'iwiin', 'scaling', 'find useful partners and approach them with a clear offer.',
         ['up to ten researched organisations', 'fit notes', 'one partnership proposal', 'outreach tracker'], '7 days', 60000, external='no introductions or outcomes are guaranteed.',
         fmt='document', stage='success'),
    item('IW-02', 'opportunity readiness review', 'iwiin', 'scaling', 'know which gaps to close before you apply for an opportunity.',
         ['review against one grant, tender or partnership', 'action checklist'], '5 days', 35000, fmt='document', stage='success', focus='getting ready for funding the right way'),
    item('IW-03', 'grant or partnership proposal support', 'iwiin', 'scaling', 'your project presented clearly against the opportunity’s requirements.',
         ['one application', 'narrative', 'budget coordination', 'one revision'], '7 days', 80000, basis='from', external='funding decisions stay with each organisation.',
         fmt='document', stage='success'),
    item('BZ-14', 'industry licence or permit assessment', 'bizdoc', 'scaling', 'know which approvals your activity needs before you commit.',
         ['assessment for one activity and location', 'document checklist', 'application plan'], '7 days', 40000, fmt='document', stage='structure',
         focus='knowing which licences your sector needs'),
    item('BZ-20', 'industry licence or permit application', 'bizdoc', 'scaling', 'the approval your activity needs, applied for properly.',
         ['application preparation', 'submission', 'follow-up with the agency'], '14 days', 0, basis='quote', external=GOV + ' each licence is quoted after assessment.',
         fmt='file', requires=['BZ-14'], stage='structure'),
    item('ST-14', 'workflow automation', 'subt', 'scaling', 'fewer repeated manual steps in one approved process.',
         ['one workflow up to five steps', 'two compatible applications', 'testing and failure alerts'], '7 days', 75000, basis='workflow', exclusions=[SOFT],
         fmt='workspace', stage='systems', focus='taking repeated work off your hands'),
    item('ST-15', 'online store setup', 'subt', 'scaling', 'customers browse, order and pay online.',
         ['template-based store', 'up to 30 products', 'one payment gateway', 'basic delivery rules'], '7 days', 350000, exclusions=[SOFT],
         fmt='website', overlaps=['ST-06'], stage='systems'),
    item('ST-16', 'custom software discovery and specification', 'subt', 'scaling', 'define the system properly before committing to a build.',
         ['process review', 'user roles', 'prioritised requirements', 'key screens', 'build estimate'], '7 days', 100000, external='the build itself is quoted after discovery.',
         fmt='document', stage='systems'),
    item('HB-04', 'supervisor development training', 'hub', 'scaling', 'team leads assign work, check quality and report problems the same way.',
         ['two remote sessions', 'up to five supervisors', 'review templates'], 'within 7 days', 60000, fmt='guide', stage='success'),
    item('IO-01', 'physical technology needs assessment', 'iotics', 'scaling', 'find out whether devices or installations can solve a real problem.',
         ['one remote assessment', 'requirements summary', 'options and indicative scope'], '5 days', 35000, exclusions=['travel and site visits'], external='a site survey and any installation are quoted separately.',
         fmt='document', stage='systems', focus='finding the right devices for your space'),

    # ---------------- renewal and modification · business continuity ----------------
    item('MD-13', 'social media management', 'medialy', 'renewals', 'a steady presence with planned content and monthly review.',
         ['two platforms', '12 original pieces a month', 'up to four short edits from footage you supply', 'scheduling', 'one report'], 'monthly', 100000, basis='monthly', exclusions=[ADS], fmt='service', stage='success'),
    item('MD-14', 'advertising management', 'medialy', 'renewals', 'campaigns improved using their real results.',
         ['one platform', 'up to two campaigns', 'weekly checks', 'monthly report'], 'monthly', 75000, basis='monthly', exclusions=[ADS], fmt='service', requires=['MD-11'], stage='success'),
    item('MD-15', 'enquiry and sales follow-up', 'medialy', 'renewals', 'enquiries keep moving to a decision instead of going cold.',
         ['one inbox', 'up to 100 new enquiries a month', 'business-hour coverage'], 'monthly', 80000, basis='monthly', fmt='service', stage='success'),
    item('FN-04', 'bookkeeping support', 'finance', 'renewals', 'current records and a clear monthly financial position.',
         ['up to 100 transactions', 'two bank accounts', 'reconciliation', 'management reports'], 'monthly', 75000, basis='monthly', fmt='service', stage='success'),
    item('BZ-15', 'compliance record and dashboard management', 'bizdoc', 'renewals', 'obligations, evidence and deadlines kept current.',
         ['one entity', 'up to ten obligations', 'monthly review and reminders'], 'monthly', 35000, basis='monthly', exclusions=['filings and tax calculations'], fmt='service', stage='success'),
    item('ST-17', 'website and workspace care', 'subt', 'renewals', 'your digital tools maintained, with small changes handled.',
         ['one website and one workspace', 'monthly checks', 'up to two hours of minor updates'], 'monthly', 50000, basis='monthly', exclusions=['new features'], fmt='service', stage='success'),
    item('IW-04', 'opportunity monitoring', 'iwiin', 'renewals', 'relevant opportunities screened for your profile every month.',
         ['monthly search', 'up to five matches when available'], 'monthly', 40000, basis='monthly', external='the number of available opportunities varies.', fmt='service', stage='success'),
    item('HH-07', 'business performance review', 'holding', 'renewals', 'your monthly numbers turned into clear actions.',
         ['review of your dashboard', 'one meeting', 'written action list'], 'monthly', 40000, basis='monthly', fmt='service', stage='success'),
    item('HB-05', 'refresher or new-staff training', 'hub', 'renewals', 'new and existing staff use your tools correctly.',
         ['one remote session on your existing tools', 'up to five people'], 'one session', 30000, basis='session', fmt='guide', stage='success'),
    item('MD-16', 'existing design update', 'medialy', 'renewals', 'your materials stay accurate as details change.',
         ['one item', 'up to two hours of editing', 'one revision'], '3 days', 25000, basis='request', fmt='file', stage='success'),
    item('ST-18', 'user access change', 'subt', 'renewals', 'access stays right as staff join, change roles or leave.',
         ['one user across up to three services', 'updated access register'], '2 days', 10000, basis='request', fmt='service', stage='success'),
    item('BZ-24', 'cac changes (directors, shares, name or address)', 'bizdoc', 'renewals', 'your registration kept accurate as the business changes.',
         ['review of the change', 'filing preparation', 'submission and follow-up'], '14 days', 0, basis='quote', external=GOV, fmt='file', stage='structure', onboarding=[CAC_DOC]),
    item('BZ-21', 'annual returns filing', 'bizdoc', 'renewals', 'your annual returns filed on time, every year.',
         ['status check', 'preparation', 'filing and receipt'], '14 days', 0, basis='quote', external=GOV + ' late filing penalties, if any, are separate.', fmt='file', stage='success', onboarding=[CAC_DOC]),
    item('BZ-22', 'tax filing support', 'bizdoc', 'renewals', 'your tax returns prepared and filed for the right period.',
         ['records review', 'preparation', 'filing support'], '14 days', 0, basis='quote', external='taxes, penalties and charges are separate.', fmt='file', stage='success'),
    item('BZ-23', 'licence or permit renewal', 'bizdoc', 'renewals', 'your licences renewed before they lapse.',
         ['renewal check', 'preparation', 'submission and follow-up'], '14 days', 0, basis='quote', external=GOV, fmt='file', stage='success'),
    item('IO-02', 'device maintenance', 'iotics', 'renewals', 'cameras and devices kept working.',
         ['agreed checks', 'minor fixes', 'report'], 'agreed per visit', 0, basis='quote', external='parts and travel are separate.', fmt='service', stage='success'),
]

BY_CODE = {i['code']: i for i in CATALOGUE}
assert len(BY_CODE) == len(CATALOGUE), 'duplicate catalogue code'
for _i in CATALOGUE:
    assert _i['owner'] in OWNERS and _i['level'] in LEVEL_NAMES and _i['basis'] in BASIS and _i['format'] in FORMATS, _i['code']
    assert all(r in BY_CODE for r in _i['requires'] + _i['overlaps']), _i['code']


# ---------------- suggestions: answers -> a draft roadmap ----------------
# each rule: (test on the answers, [(code, urgency, reason), ...]). reasons are written to the client, in plain words.
def _has(a, key, *vals):
    v = a.get(key)
    vs = v if isinstance(v, list) else [v]
    return any(x in vs for x in vals)


def _any(a, key, *frags):
    v = a.get(key)
    vs = v if isinstance(v, list) else [v]
    return any(f in str(x or '') for x in vs for f in frags)


def _text(a, *keys):
    return ' '.join(str(x) for k in keys for x in (a.get(k) if isinstance(a.get(k), list) else [a.get(k) or ''])).lower()


def is_ngo(a):
    return bool(re.search(r'\b(ngos?|foundation|association|charity|church|mosque|non-?profit)\b', _text(a, 'industry', 'details', 'industry_other', 'details_other', 'needs')))


def heavy(a):
    """sectors where a limited company and sector approvals are the norm."""
    return any(w in _text(a, 'industry', 'details', 'industry_other', 'details_other') for w in ('mining', 'oil and gas', 'construction'))


def unregistered(a):
    return _has(a, 'registered', 'not yet') or _has(a, 'situation', 'nothing is registered yet') or (a.get('path') == 'start' and not a.get('registered'))


def reg_type(a):
    """which registration fits: trustees for an ngo, a limited company for contracts, partners, heavy sectors or bigger teams, else a business name."""
    if is_ngo(a):
        return 'BZ-16'
    if heavy(a) or a.get('path') in ('contract', 'partnership') or _has(a, 'team', '6 to 20', 'more than 20'):
        return 'BZ-02'
    return 'BZ-01'


REG_REASON = {'BZ-01': 'you told us the business is not registered yet. a business name is the simplest start.',
              'BZ-02': 'you told us you are not registered yet. for your kind of work, a limited company is usually expected.',
              'BZ-16': 'you told us you are not registered yet. an ngo or association registers as incorporated trustees.'}


def _reg(a, urg, reason=None):
    code = reg_type(a)
    return [(code, urg, reason or REG_REASON[code])]


# the first three industries we serve: each gets a starter roadmap built from the catalogue
INDUSTRY_STARTERS = {
    'cleaning': [('ST-04', 1, 'one place to track bookings, which team goes where, and what was paid.'),
                 ('BZ-09', 1, 'clear terms for the cleaners you send into clients\' homes and offices.'),
                 ('ST-02', 2, 'people search for cleaners nearby. a google profile helps them find you.'),
                 ('MD-12', 2, 'regular clients are the heart of a cleaning business. this gives them a reason to rebook.'),
                 ('HH-04', 2, 'simple checklists so every job is done the same way.'),
                 ('MD-01', 3, 'a brand clients recognise on uniforms and messages.')],
    'decoration': [('MD-02', 1, 'clients choose decorators by their past work. a profile and portfolio shows it.'),
                   ('BZ-10', 1, 'clean quotes, invoices and receipts for materials and milestone payments.'),
                   ('BZ-08', 1, 'an agreement that sets the scope, materials, approvals and payment stages.'),
                   ('MD-07', 2, 'before and after photos are your best marketing. this sets up how you share them.'),
                   ('ST-02', 2, 'so people searching nearby can find and call you.'),
                   ('ST-04', 3, 'one place to track jobs, materials and payments.')],
    'tailoring': [('ST-04', 1, 'one place for measurements, orders, fittings and collection dates.'),
                  ('ST-01', 1, 'most orders come on whatsapp. a proper setup keeps them organised.'),
                  ('BZ-10', 2, 'clear order slips, invoices and receipts, so deposits and balances are never in doubt.'),
                  ('MD-07', 2, 'a steady way to show new styles and finished pieces.'),
                  ('MD-01', 2, 'a label and look customers remember.'),
                  ('MD-12', 3, 'a reason for customers to come back for the next occasion.')],
}


def industry(a):
    t = _text(a, 'industry', 'industry_other', 'details', 'details_other', 'business')
    if 'cleaning' in t:
        return 'cleaning'
    if 'decorat' in t or 'painting' in t or 'interior' in t:
        return 'decoration'
    if 'tailor' in t or 'fashion' in t or 'sewing' in t:
        return 'tailoring'
    return ''


RULES = [
    # where they are
    (lambda a: a.get('path') == 'start', [('HH-01', 1, 'you are starting out, so a clear direction comes first.'), ('MD-01', 2, 'a simple brand helps customers trust you from day one.'),
                                         ('ST-01', 2, 'an organised whatsapp captures your first enquiries.'), ('MD-03', 3, 'a clear offer sheet shows customers what they can buy.')]),
    (lambda a: a.get('path') == 'contract', [('BZ-08', 1, 'you won a contract, so the agreement should protect you before work starts.'),
                                            ('BZ-09', 2, 'the people delivering the contract need clear terms.'), ('BZ-10', 2, 'quotes, invoices and sign-offs keep the contract clean.'),
                                            ('BZ-17', 2, 'many contracts ask for nsitf compliance. we will check if yours does.'),
                                            ('BZ-18', 2, 'many contracts ask for pencom compliance. we will check if yours does.'),
                                            ('BZ-19', 2, 'public contracts usually need bpp registration. we will check if yours does.')]),
    (lambda a: a.get('path') == 'contract' and not _has(a, 'team', 'just me'), [('HH-02', 2, 'clear roles help your team deliver on time.')]),
    (lambda a: a.get('path') == 'partnership', [('IW-02', 1, 'a readiness review shows what to fix before you apply.'), ('IW-03', 2, 'a strong application presents your project clearly.'),
                                               ('MD-02', 2, 'a company profile helps partners understand you quickly.')]),
    (lambda a: a.get('path') == 'grow', [('HH-01', 2, 'a clear direction keeps growth focused.')]),
    # registration
    (unregistered, lambda a: _reg(a, 1) + [('BZ-03', 2, 'banks and clients will ask for a tin.')]),
    (lambda a: bool(industry(a)), lambda a: INDUSTRY_STARTERS[industry(a)]),
    (lambda a: a.get('path') == 'contract' and not unregistered(a), [('BZ-03', 2, 'contracts pay into a business with a tin. we will check yours is in order.')]),
    (lambda a: _has(a, 'registered', 'not sure'), [('BZ-13', 1, 'you were not sure about registration, so we will check exactly what applies to you.')]),
    (lambda a: is_ngo(a), [('BZ-07', 2, 'ngos and foundations usually need scuml. we will confirm it applies to you.')]),
    (lambda a: heavy(a) and _any(a, 'industry', 'details', 'industry_other', 'details_other', 'mining', 'oil and gas') if False else
     any(w in _text(a, 'industry', 'details', 'industry_other', 'details_other') for w in ('mining', 'oil and gas')),
     [('BZ-06', 1, 'mining, oil and gas businesses usually need scuml. we will confirm it applies to you.'),
      ('BZ-14', 1, 'your sector needs its own approvals. this finds exactly which ones apply.'), ('BZ-20', 2, 'once we know the licence, we apply for it properly.')]),
    (lambda a: any(w in _text(a, 'industry', 'details') for w in ('real estate', 'hospitality')), [('BZ-05', 2, 'property and hospitality businesses usually need scuml. we will confirm it applies to you.')]),
    # what slows them down
    (lambda a: _has(a, 'challenge', 'customers do not find us easily'), [('ST-02', 1, 'you said customers do not find you easily.'), ('MD-05', 2, 'a clear position makes you easier to choose.')]),
    (lambda a: _has(a, 'challenge', 'people ask, but do not buy'), [('MD-04', 1, 'you said people ask but do not buy. clear replies guide them to a decision.'), ('MD-06', 2, 'a follow-up process stops enquiries going cold.')]),
    (lambda a: _has(a, 'challenge', 'we do too much by hand'), [('ST-14', 2, 'you said you do too much by hand.'), ('HH-03', 2, 'written processes stop work depending on you.')]),
    (lambda a: _has(a, 'challenge', 'orders, records or money get lost'), [('ST-04', 1, 'you said orders, records or money get lost.'), ('FN-02', 2, 'proper records show where your money goes.')]),
    (lambda a: _has(a, 'challenge', 'our papers or compliance are not sorted'), [('BZ-13', 1, 'you said your papers are not sorted. this shows exactly what applies to you.')]),
    (lambda a: _has(a, 'challenge', 'we have no website or online presence'), [('ST-02', 1, 'you have no online presence yet. google is the quickest place to start.'), ('ST-06', 2, 'a website gives customers one clear place to reach you.')]),
    (lambda a: _has(a, 'challenge', 'the team needs better skills'), [('HB-02', 2, 'you said your team needs better skills.'), ('HH-02', 2, 'clear roles make training stick.')]),
    (lambda a: _has(a, 'challenge', 'we need funding to grow'), [('IW-02', 1, 'you said you need funding. this shows what to fix before you apply.'), ('FN-03', 2, 'funders look for a clear budget and cash-flow plan.')]),
    # what they want help with (holding questions)
    (lambda a: _has(a, 'needs', 'registration, documents and compliance'), lambda a: [('BZ-13', 2, 'you asked for help with registration and compliance.')] + _reg(a, 2, 'we will confirm the right registration for you first.')),
    (lambda a: _has(a, 'needs', 'a brand, logo and social media'), [('MD-01', 1, 'you asked for a brand and logo.'), ('MD-07', 2, 'a launch kit keeps your social media consistent.')]),
    (lambda a: _has(a, 'needs', 'marketing that brings customers'), [('MD-05', 1, 'you asked for marketing that brings customers.'), ('MD-11', 3, 'a focused campaign can bring enquiries once your offer is clear.')]),
    (lambda a: _has(a, 'needs', 'a website or online shop'), [('ST-06', 1, 'you asked for a website.'), ('ST-15', 3, 'an online store lets customers order and pay online.')]),
    (lambda a: _has(a, 'needs', 'ai tools that answer customers or do admin'), [('ST-01', 1, 'you asked for tools that answer customers.'), ('ST-14', 2, 'automation takes repeated admin off your hands.')]),
    (lambda a: _has(a, 'needs', 'automating repeated work (orders, invoices, reports)'), [('ST-14', 1, 'you asked to automate repeated work.'), ('BZ-10', 2, 'standard invoices and receipts make automation simple.')]),
    (lambda a: _has(a, 'needs', 'cctv, smart devices or installations'), [('IO-01', 1, 'you asked about devices or installations.')]),
    (lambda a: _has(a, 'needs', 'training for me or my team'), lambda a: [('HB-02', 1, 'you asked for training for your team.')] if _has(a, 'team', '6 to 20', 'more than 20') else [('HB-01', 1, 'you asked for training.'), ('HB-02', 2, 'team training helps everyone work the same way.')]),
    (lambda a: _has(a, 'needs', 'grants, funding or partnerships'), [('IW-02', 1, 'you asked about funding or partnerships.'), ('IW-01', 2, 'a partnership kit helps you approach the right partners.')]),
    # venture questions: bizdoc
    (lambda a: _has(a, 'needs', 'business registration or incorporation'), lambda a: _reg(a, 1, 'you asked for registration. we suggest the type that fits what you told us.')),
    (lambda a: _has(a, 'needs', 'cac changes (directors, shares, name)'), [('BZ-24', 1, 'you asked for cac changes.')]),
    (lambda a: _has(a, 'needs', 'tax registration, tin or annual returns'), [('BZ-03', 1, 'you asked about tax registration.'), ('BZ-21', 2, 'annual returns keep the business in good standing.'),
                                                                             ('BZ-22', 2, 'tax filings on time avoid penalties.')]),
    (lambda a: _has(a, 'needs', 'licences, permits or approvals for my sector') or _has(a, 'situation', 'registered, i need licences or permits'),
     [('BZ-14', 1, 'you need sector approvals. this finds exactly which ones apply.'), ('BZ-20', 2, 'once we know the licence, we apply for it properly.')]),
    (lambda a: _has(a, 'needs', 'contracts, agreements or board resolutions'), [('BZ-08', 1, 'you asked for contracts and agreements.'), ('BZ-12', 2, 'a review finds risky terms before you sign.')]),
    (lambda a: _has(a, 'needs', 'a compliance check: what am i missing?'), [('BZ-13', 1, 'you asked for a compliance check.')]),
    (lambda a: _has(a, 'needs', 'renewals and ongoing compliance') or _has(a, 'situation', 'i need renewals or filings'), [('BZ-15', 3, 'ongoing compliance keeps every deadline visible.'), ('BZ-21', 1, 'you need filings or renewals.'),
                                                                                                             ('BZ-23', 2, 'licences and permits renewed before they lapse.')]),
    (lambda a: _has(a, 'details', 'health', 'education', 'construction', 'real estate', 'manufacturing', 'agriculture', 'transport and logistics')
     or _has(a, 'industry', 'health and care', 'real estate and building', 'manufacturing', 'food and drink', 'agriculture', 'education and training', 'logistics and transport', 'construction'),
     [('BZ-14', 2, 'your sector usually needs its own approvals. we will check which apply.')]),
    # venture questions: medialy
    (lambda a: _any(a, 'needs', 'a brand: name, logo and identity'), [('MD-01', 1, 'you asked for a brand.')]),
    (lambda a: _any(a, 'needs', 'company profile and marketing materials'), [('MD-02', 1, 'you asked for a company profile.')]),
    (lambda a: _any(a, 'needs', 'social media management'), [('MD-07', 1, 'a launch kit sets your social media up properly.'), ('MD-13', 2, 'monthly management keeps it consistent.')]),
    (lambda a: _any(a, 'needs', 'content, photos or video'), [('MD-07', 2, 'you asked for content.'), ('MD-13', 2, 'monthly content keeps you visible.')]),
    (lambda a: _any(a, 'needs', 'ads that bring customers'), [('MD-11', 1, 'you asked for ads that bring customers.'), ('MD-14', 3, 'monthly management improves ads over time.')]),
    (lambda a: _any(a, 'needs', 'a website or landing page that sells'), [('ST-06', 1, 'you asked for a website that sells.')]),
    (lambda a: _any(a, 'needs', 'market research or competitor insight'), [('MD-05', 1, 'research shapes a clear position.')]),
    (lambda a: _any(a, 'needs', 'more leads and better follow-up'), [('MD-06', 1, 'you asked for better follow-up.'), ('MD-15', 2, 'we can follow up enquiries for you every month.')]),
    # venture questions: subt
    (lambda a: _any(a, 'needs', 'a website or web app'), [('ST-06', 1, 'you asked for a website.')]),
    (lambda a: _any(a, 'needs', 'a mobile app', 'software for my operations'), [('ST-16', 1, 'custom software starts with a clear specification.')]),
    (lambda a: _any(a, 'needs', 'an ai assistant or chatbot'), [('ST-01', 1, 'an organised whatsapp is the base for any assistant.'), ('ST-14', 2, 'automation lets replies go out by themselves.')]),
    (lambda a: _any(a, 'needs', 'automating repeated work'), [('ST-14', 1, 'you asked to automate repeated work.')]),
    (lambda a: _any(a, 'needs', 'online booking, payments or an e-commerce store'), [('ST-15', 1, 'you asked for online orders and payments.')]),
    (lambda a: _any(a, 'needs', 'dashboards and reports'), [('ST-09', 1, 'you asked for dashboards.')]),
    (lambda a: _any(a, 'needs', 'support for a system i already have'), [('ST-17', 2, 'you asked for support on your existing system. we will check it first.')]),
    # venture questions: iotics
    (lambda a: _any(a, 'needs', 'smart home', 'cctv', 'smart access', 'lighting, power', 'sensors', 'industrial or farm', 'robotics or prototype'), [('IO-01', 1, 'an assessment finds the right devices for your space.')]),
    (lambda a: _any(a, 'needs', 'maintenance of existing devices'), [('IO-02', 1, 'you asked for maintenance of existing devices.')]),
    # venture questions: hub
    (lambda a: _any(a, 'needs', 'digital basics', 'ai for work', 'a professional course'), [('HB-01', 1, 'practical training you can use the next day.')]),
    (lambda a: _any(a, 'needs', 'training for my team', 'a workshop or bootcamp'), [('HB-02', 1, 'team training gets everyone working the same way.')]),
    # venture questions: iwiin
    (lambda a: _any(a, 'needs', 'find grants that fit me', 'a funding strategy'), [('IW-02', 1, 'a readiness review shows which opportunities fit you.'), ('IW-04', 3, 'monthly monitoring tells you about suitable opportunities when they open.')]),
    (lambda a: _any(a, 'needs', 'write a grant or funding proposal', 'scholarship, fellowship', 'ngo or impact project'), [('IW-03', 1, 'you asked for help with an application.')]),
    (lambda a: _any(a, 'needs', 'a business plan or pitch deck'), [('HH-01', 1, 'a clear business model is the core of a plan or pitch.')]),
    (lambda a: _any(a, 'needs', 'partnerships or sponsorships'), [('IW-01', 1, 'you asked for partnerships.')]),
    (lambda a: _any(a, 'needs', 'tender research and bid documents') or _has(a, 'situation', 'a tender or contract'),
     [('IW-02', 1, 'a readiness review checks you against the tender.'), ('BZ-19', 2, 'public tenders usually need bpp registration.')]),
    (lambda a: _has(a, 'situation', 'a scholarship, fellowship or accelerator', 'a grant', 'investors'), [('IW-02', 1, 'a readiness review shows what to fix before you apply.')]),
    # size and maturity
    (lambda a: _has(a, 'team', '6 to 20', 'more than 20'), [('HH-02', 2, 'with a growing team, clear roles matter.'), ('BZ-09', 2, 'staff and contractors need clear agreements.'), ('ST-11', 3, 'more people means access needs managing.')]),
    (lambda a: _has(a, 'impact', 'my team works without me watching'), [('HH-03', 1, 'you want the team to work without you watching.'), ('HH-04', 2, 'simple routines keep everyone on track.')]),
    (lambda a: _has(a, 'impact', 'ready to grow or raise funding'), [('IW-02', 2, 'you want to be ready for funding.'), ('HH-06', 3, 'a growth plan shows how you will deliver more.')]),
    (lambda a: _has(a, 'impact', 'we make more money'), [('FN-01', 2, 'pricing that covers your costs is the quickest place to check.')]),
    (lambda a: _has(a, 'impact', 'more customers come back'), [('MD-12', 2, 'a simple retention programme gives customers a reason to return.')]),
    (lambda a: _any(a, 'needs', 'entrepreneurship and mentorship'), [('HH-01', 1, 'a clear business model is where mentorship starts.')]),
    (lambda a: _has(a, 'details', 'none of these yet') and _has(a, 'venture', 'iwiin'), lambda a: _reg(a, 2, 'most funders ask for a registered organisation. we will confirm what you need.')),
    (lambda a: _has(a, 'stage', 'running more than 3 years'), [('BZ-11', 3, 'after years of building a name, protecting it makes sense.'), ('ST-12', 3, 'a tested backup protects years of records.')]),
]

# plain focus phrases for items written without one. what we look at, never a promised result.
FOCUS_MORE = {
    'BZ-02': 'registering your company properly', 'BZ-16': 'registering your organisation properly', 'BZ-03': 'your tax identification', 'BZ-04': 'a board resolution for your bank',
    'BZ-05': 'checking your scuml obligations', 'BZ-06': 'scuml and the approvals your sector needs', 'BZ-07': 'scuml for your organisation',
    'BZ-10': 'clean quotes, invoices and receipts', 'BZ-11': 'protecting your business name', 'BZ-12': 'checking agreements before you sign', 'BZ-13': 'what your business needs to be compliant',
    'BZ-14': 'the licences your sector needs', 'BZ-15': 'keeping every compliance date visible', 'BZ-17': 'contractor compliance papers', 'BZ-18': 'contractor compliance papers',
    'BZ-19': 'registration to bid for public contracts', 'BZ-20': 'applying for your licence', 'BZ-21': 'annual returns on time', 'BZ-22': 'tax filings on time', 'BZ-23': 'licence renewals on time',
    'BZ-24': 'updating your cac records', 'MD-02': 'a profile that explains your business', 'MD-03': 'a clear offer customers can read', 'MD-05': 'a clear position in your market',
    'MD-06': 'following up every enquiry', 'MD-07': 'a consistent social media start', 'MD-11': 'one focused campaign', 'MD-12': 'reasons for customers to come back', 'MD-13': 'a steady social media presence',
    'MD-14': 'improving your ads over time', 'MD-15': 'following up every enquiry', 'ST-01': 'an organised whatsapp', 'ST-02': 'being found on google', 'ST-03': 'organised files and access',
    'ST-04': 'one place to track orders and records', 'ST-05': 'a professional email', 'ST-07': 'customer details in one system', 'ST-08': 'tasks and deadlines everyone can see', 'ST-09': 'your key numbers in one view',
    'ST-11': 'who can access what', 'ST-12': 'a tested backup of your records', 'ST-14': 'less repeated admin', 'ST-15': 'taking orders and payments online', 'ST-16': 'a clear plan for your software',
    'ST-17': 'keeping your tools working', 'FN-01': 'pricing that covers your costs', 'FN-02': 'records that show where money goes', 'FN-03': 'a budget and cash-flow plan', 'FN-04': 'your books kept up to date',
    'HH-02': 'clear roles for your team', 'HH-04': 'simple routines for the team', 'HH-06': 'a plan for the next stage of growth', 'HB-01': 'training you can use the next day', 'HB-02': 'your team working the same way',
    'IW-01': 'approaching the right partners', 'IW-02': 'what to fix before you apply', 'IW-03': 'a clear application', 'IW-04': 'watching for suitable opportunities', 'IO-02': 'keeping your devices working',
}
for _i in CATALOGUE:
    if not _i['focus'] and _i['code'] in FOCUS_MORE:
        _i['focus'] = FOCUS_MORE[_i['code']]

LEVEL_ORDER = list(LEVEL_NAMES)


NEEDS_REGISTRATION = {'BZ-21', 'BZ-22', 'BZ-23', 'BZ-24', 'BZ-15', 'BZ-04'}  # these only apply once a business exists
REGISTRATION = {'BZ-01', 'BZ-02', 'BZ-16'}
FALLBACK = ('HH-01', 2, 'we will look at your answers together and suggest where to start.')


def suggest(answers, limit=10):
    """turn start-here answers into draft roadmap items: [{code, urgency, reason}], most urgent first.
    a person at the holding always reviews this before the client sees any price."""
    a = {k: v for k, v in (answers or {}).items()}
    picked, order = {}, {}
    for test, items in RULES:
        try:
            ok = test(a)
            rows = items(a) if callable(items) else items
        except Exception:
            ok = False
        if not ok:
            continue
        for code, urg, reason in rows:
            order.setdefault(code, len(order))
            if code not in picked or urg < picked[code]['urgency']:
                picked[code] = {'code': code, 'urgency': urg, 'reason': reason}
    if unregistered(a):
        for code in NEEDS_REGISTRATION:
            picked.pop(code, None)
    # one registration and one scuml category only: keep the most urgent of each group (the type that fits wins a tie)
    fit = reg_type(a)
    by_group = {}
    for code in sorted(picked, key=lambda c: order[c]):
        g = BY_CODE[code]['group']
        if not g:
            continue
        if g in by_group:
            keep, drop = sorted([by_group[g], code], key=lambda c: (picked[c]['urgency'], c != fit, order[c]))
            picked.pop(drop, None)
            by_group[g] = keep
        else:
            by_group[g] = code
    # a compliance check is not needed when we already know the registration to do
    if REGISTRATION & set(picked) and 'BZ-13' in picked and unregistered(a):
        picked.pop('BZ-13')
    # overlapping services: keep the more urgent one, never both
    for code in sorted(picked, key=lambda c: (picked[c]['urgency'], order[c])):
        if code not in picked:
            continue
        for other in set(BY_CODE[code]['overlaps']) | {c for c in picked if code in BY_CODE[c]['overlaps']}:
            if other in picked and (picked[other]['urgency'], order[other]) > (picked[code]['urgency'], order[code]):
                picked.pop(other)
    # a needs-first item brings its requirement along, at the same urgency
    for code in list(picked):
        for req in BY_CODE[code]['requires']:
            if req == 'BZ-02' and 'BZ-02' not in picked:
                continue  # a banking resolution only applies to companies that already exist
            if req not in picked:
                order.setdefault(req, order[code] - 0.5)
                picked[req] = {'code': req, 'urgency': picked[code]['urgency'], 'reason': f'needed before {BY_CODE[code]["name"]}.'}
    if not picked:
        picked[FALLBACK[0]] = {'code': FALLBACK[0], 'urgency': FALLBACK[1], 'reason': FALLBACK[2]}
        order[FALLBACK[0]] = 0
    # urgent requests lift the top setup items (never a monthly service)
    hot = (str(a.get('urgency', '')) in ('today or tomorrow', 'this week', 'within 2 weeks') or str(a.get('importance', '')) in ('8', '9', '10')
           or str(a.get('timing', '')) == 'right away')
    rank = lambda x: (x['urgency'], x['code'] not in REGISTRATION, order[x['code']])  # registration leads its urgency
    out = sorted(picked.values(), key=rank)
    if hot:
        for x in out[:3]:
            if x['urgency'] == 2 and BY_CODE[x['code']]['basis'] != 'monthly':
                x['urgency'] = 1
        out.sort(key=rank)
    return out[:limit]


def focus_lines(suggested, n=3):
    """short plain phrases for the client: what we will look at first. no prices."""
    lines = []
    for x in suggested:
        f = BY_CODE[x['code']].get('focus')
        if f and f not in lines:
            lines.append(f)
        if len(lines) == n:
            break
    return lines
