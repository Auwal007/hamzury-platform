/* hamzury public content. edit this file to change what visitors read: venture offers, the hm formula,
   proof of work, the library and the gallery. everything stays in brand voice: lowercase, plain, honest. */
window.HZ = {
  founder: { name: 'haruna muhammad', site: 'https://hm.hamzury.com' },
  ridli: 'https://ridli.org',

  ventures: {
    bizdoc: {
      name: 'bizdoc', area: 'business compliance, licensing and corporate documentation',
      line: 'registered, compliant, ready.',
      value: 'whatever your industry, bizdoc finds the documents and approvals your business needs, gets them, and keeps them current.',
      offers: [
        'business registration, incorporation, cac amendments and restructuring',
        'tax registration, tin, annual returns and statutory filings',
        'industry licences, permits, certificates and regulatory approvals',
        'sector documentation: mining, oil and gas, agriculture, health, education, construction, real estate and more',
        'corporate profiles, board resolutions, contracts, agreements and policies',
        'regulatory assessments, compliance roadmaps and advisory support',
        'renewals, regulatory updates and ongoing compliance support',
      ],
    },
    medialy: {
      name: 'medialy', area: 'branding, marketing, communication and growth',
      line: 'seen, trusted, chosen.',
      value: 'medialy connects you with the right audience and turns attention into customers who come back.',
      offers: [
        'brand strategy, positioning, naming, identity and visual design',
        'graphic design, company profiles, marketing materials and brand guidelines',
        'content strategy, photography, video and creative campaigns',
        'social media management, digital advertising and campaign optimisation',
        'website and landing page strategy, search visibility and online presence',
        'market research, customer insights and competitor analysis',
        'lead generation, sales funnels, crm, customer acquisition and retention',
        'marketing consultancy, communication strategy, public relations and reporting',
      ],
    },
    subt: {
      name: 'subt', area: 'software, artificial intelligence and business automation',
      line: 'ai and automation that work for you.',
      value: 'subt takes repeated work off your hands, so your business runs smoother and is ready to grow.',
      offers: [
        'business websites, web apps, mobile apps and digital platforms',
        'custom and industry-specific software',
        'crm, erp, inventory, finance, hr, school, hospital and operations systems',
        'ai assistants, chatbots and intelligent business tools',
        'workflow automation, process digitisation and system integration',
        'online booking, e-commerce, client portals and payment platforms',
        'data dashboards, reporting and business intelligence',
        'maintenance, technical support and digital transformation advice',
      ],
    },
    iotics: {
      name: 'iotics', area: 'internet of things, robotics and smart technology',
      line: 'smarter, safer spaces.',
      value: 'iotics connects your physical spaces to intelligent technology, for more convenience, safety and control.',
      offers: [
        'smart home, office and building automation',
        'intelligent lighting, water management and equipment control',
        'iot sensors, monitoring devices and remote control systems',
        'security monitoring and smart access',
        'robotics development, electronic prototypes and embedded systems',
        'hardware design, installation, integration and maintenance',
        'industrial and agricultural monitoring and automation',
        'robotics education, technical workshops and innovation projects',
      ],
    },
    hub: {
      name: 'hamzury hub', area: 'digital education, skills mastery and entrepreneurship',
      line: 'a team that knows how.',
      value: 'hamzury hub turns learning into real skill, real work and real enterprise.',
      offers: [
        'digital foundation, computer literacy, workplace productivity and ai literacy',
        'flexible skills mastery with personal learning paths and practical assessments',
        'corporate training, workforce upskilling and institutional capacity building',
        'professional courses: software, data, digital marketing, ai, design and automation',
        'junior innovator programmes in creativity, coding, robotics and technology',
        'it/siwes, internships, junior staff training and supervised work experience',
        'innovator to ceo, ceo to founder and advanced enterprise programmes',
        'mentorship, workshops, bootcamps, masterclasses and career readiness',
      ],
    },
    iwiin: {
      name: 'iwiin', area: 'grants, partnerships, funding and opportunities',
      line: 'ready for funding.',
      value: 'iwiin finds the opportunities that fit you, prepares strong applications and builds the relationships behind them. funding and selection decisions stay with each organisation.',
      offers: [
        'local and international grant research',
        'grant writing, funding proposals and application support',
        'business plans, pitch decks and investor-readiness documents',
        'scholarship, fellowship, accelerator and innovation programme applications',
        'strategic partnerships, sponsorships and institutional collaborations',
        'ngo, social impact and development project proposals',
        'tender research and bid documentation',
        'funding strategy, programme design and impact reporting',
      ],
    },
  },

  // the hm formula: haruna muhammad's way of building anything that lasts
  formula: [
    ['awareness', 'see clearly where you are and what is really slowing you down.'],
    ['strategy', 'decide what to do first, and why.'],
    ['structure', 'put the right papers, people and processes in place.'],
    ['systems', 'let tools and automation carry the repeated work.'],
    ['success', 'grow, measure, and take the next step with confidence.'],
  ],
  method: [
    ['understand', 'we learn your business, where you are, what is in the way and where you want to go.'],
    ['architect', 'we draw a practical roadmap through awareness, strategy, structure and systems.'],
    ['connect', 'we bring in the right team, or the right combination of teams.'],
    ['execute', 'responsible teams deliver, with clear steps and progress you can follow.'],
    ['improve', 'we review the results, close the gaps and show you the next stage.'],
  ],
  who: [
    ['you have an idea', 'we help you shape it, register it and launch it properly.'],
    ['you won a contract', 'we help you get the papers, people and systems to deliver it.'],
    ['you run a business', 'we help you fix what slows it down and build what grows it.'],
    ['you lead an institution', 'we help you train people, modernise systems and find partners.'],
  ],

  // our offices. the short links (hamzury.com/visit/abuja, /visit/jos) open straight in google maps, for sharing on whatsapp
  offices: [
    { key: 'abuja', city: 'abuja', label: 'head office', lines: ['suite 4, ajami plaza', 'plot 500b tafawa balewa way', 'area 3, garki, abuja'],
      maps: 'https://www.google.com/maps/search/?api=1&query=9.028329%2C7.478382', directions: 'https://www.google.com/maps/dir/?api=1&destination=9.028329%2C7.478382' },
    { key: 'jos', city: 'jos', label: 'hamzury innovation hub', lines: ['hamzury innovation hub', 'jos, plateau state'],
      maps: 'https://www.google.com/maps/place/hamzury+innovation+hub/@9.9303296,8.8896841,17z/data=!3m1!4b1!4m6!3m5!1s0x1053738fbdc0e88f:0x1d70274660173290!8m2!3d9.9303296!4d8.892259',
      directions: 'https://www.google.com/maps/dir/?api=1&destination=9.9303296%2C8.892259' },
  ],

  // the first three industries, each with a ready roadmap built from the catalogue
  first: [
    ['cleaning services', 'bookings, teams, checklists and clients who rebook.'],
    ['interior decoration and painting', 'a portfolio, clear quotes and payment stages.'],
    ['fashion and tailoring', 'measurements, orders, fittings and collection dates in one place.'],
  ],

  // proof of work: real work only, shared with the client's permission. while this list is empty the section stays hidden.
  // { client: 'ada foods', industry: 'food and drink', venture: 'subt', need: '...', did: '...', result: '...', quote: '', year: '2026' }
  proof: [],

  // library: view online now. set download to a file path when it is ready.
  library: [
    { title: 'hamzury holding corporate profile', kind: 'profile', text: 'who we are, the hm formula, our six ventures and what each one offers.', view: '/library/profile', download: '' },
    { title: 'the hm formula', kind: 'method', text: 'the five connected stages haruna muhammad uses to build anything that lasts.', view: '/#formula', download: '' },
    { title: 'venture catalogues', kind: 'catalogue', text: 'detailed packages, requirements and deliverables for each venture.', view: '', download: '' },
    { title: 'reports and insights', kind: 'report', text: 'what we learn from the work, shared to help you decide better.', view: '', download: '' },
  ],

  // gallery: replace each placeholder with a real photo in /static/gallery/ and write a real caption.
  gallery: [
    { src: '/static/gallery/placeholder-01.jpg', title: 'the holding desk', caption: 'where every plan starts: reading each client\'s answers, one by one.', date: 'november 2026', year: 2026, kind: 'team', placeholder: true },
    { src: '/static/gallery/placeholder-02.jpg', title: 'first proposal delivered', caption: 'a milestone worth remembering.', date: 'october 2026', year: 2026, kind: 'achievements', placeholder: true },
    { src: '/static/gallery/placeholder-03.jpg', title: 'hamzury hub class', caption: 'skills your people use the next day.', date: 'october 2026', year: 2026, kind: 'moments', placeholder: true },
    { src: '/static/gallery/placeholder-04.jpg', title: 'team planning day', caption: 'six ventures, one table.', date: 'september 2026', year: 2026, kind: 'team', placeholder: true },
    { src: '/static/gallery/placeholder-05.jpg', title: 'iotics installation', caption: 'a smarter, safer space, switched on.', date: 'august 2026', year: 2026, kind: 'moments', placeholder: true },
    { src: '/static/gallery/placeholder-06.jpg', title: 'community digital literacy day', caption: 'opening doors, one laptop at a time.', date: 'july 2026', year: 2026, kind: 'events', placeholder: true },
    { src: '/static/gallery/placeholder-07.jpg', title: 'founder\'s talk', caption: 'haruna muhammad on the hm formula.', date: 'june 2026', year: 2026, kind: 'events', placeholder: true },
    { src: '/static/gallery/placeholder-08.jpg', title: 'junior innovators', caption: 'the next builders, building.', date: 'may 2026', year: 2026, kind: 'moments', placeholder: true },
    { src: '/static/gallery/placeholder-09.jpg', title: 'where it began', caption: 'the first office, the first idea.', date: '2025', year: 2025, kind: 'achievements', placeholder: true },
    { src: '/static/gallery/placeholder-10.jpg', title: 'end of year together', caption: 'grateful for every step.', date: 'december 2025', year: 2025, kind: 'team', placeholder: true },
  ],
};
