import type { Phrase } from './i18n'

/**
 * What the chat panel says when the answer is a number rather than a
 * page from the manual.
 *
 * These were English string literals inside the component, which made
 * the language picker a half-truth: choosing മലയാളം translated anything
 * quoted from the manual and left every figure in English. A person who
 * needs the Malayalam manual needs the Malayalam sentence around their
 * score more, not less.
 *
 * Same rules as help-strings.ts. Literal and short rather than fluent,
 * because these state figures that decide an appraisal. Anything the
 * software prints stays in English inside the sentence — band names
 * (Good, Excellent), KPI, Job Role, Core Values, ESMS — so the reader
 * can find it on a screen afterwards. See KEEP_ENGLISH.
 *
 * Not reviewed by a native speaker. The four sit on adjacent lines so
 * somebody who reads one can correct it against the English above it.
 */
export const CHAT: Record<string, Phrase> = {
  greeting: {
    en: 'Hello {name}. Ask me about your KPI, your score, or any month of this year.',
    ml: 'ഹലോ {name}. നിങ്ങളുടെ KPI, സ്കോർ, അല്ലെങ്കിൽ ഈ വർഷത്തെ ഏതെങ്കിലും മാസത്തെക്കുറിച്ച് ചോദിക്കൂ.',
    hi: 'नमस्ते {name}। अपने KPI, अपने स्कोर, या इस वर्ष के किसी भी महीने के बारे में पूछें।',
    te: 'హలో {name}. మీ KPI, మీ స్కోర్, లేదా ఈ సంవత్సరంలోని ఏ నెల గురించైనా అడగండి.',
    ta: 'வணக்கம் {name}. உங்கள் KPI, மதிப்பெண், அல்லது இந்த ஆண்டின் எந்த மாதம் பற்றியும் என்னிடம் கேளுங்கள்.',
  },
  /*
    What Cyra says before being asked anything.

    Everything here is something the person is holding up or is held up
    by, and every one of them already exists as a badge somewhere — on a
    tab, on a bell, on a tile. A badge is a number you have to go and
    interpret. These are the same facts as a sentence with the way to
    fix them attached, which is the difference between being told and
    being nagged.

    Deliberately short and finite. Cyra opens with at most a handful,
    never a list of everything that could be said, because a panel that
    greets somebody with eight paragraphs is one they stop opening.
  */
  /*
    "Did you know" — one per opening, rotating. See lib/tips.ts.

    Written the way a colleague mentions something in passing, which is
    the register BEMMP's Cyra uses and the one that suits a fact nobody
    asked for: short, a contraction or two, no exclamation marks and no
    "Pro tip!". Each one names a thing that exists and is one tap away,
    and the tap is attached.

    They state what the feature IS FOR rather than where it lives. "You
    can add a photo on your profile" is a map reference; "put a face to
    your name — your manager sees it on every list" is a reason, and the
    link handles the where.
  */
  'tip.lead': {
    en: 'Did you know —',
    ml: 'നിങ്ങൾക്കറിയാമോ —',
    hi: 'क्या आप जानते हैं —',
    te: 'మీకు తెలుసా —',
    ta: 'உங்களுக்குத் தெரியுமா —',
  },
  'tip.photo': {
    en: 'you can put a photo on your record? Your manager sees it on every list, and a face is easier to find than a code.',
    ml: 'നിങ്ങളുടെ റെക്കോർഡിൽ ഒരു ഫോട്ടോ ചേർക്കാം? എല്ലാ ലിസ്റ്റിലും നിങ്ങളുടെ മാനേജർ അത് കാണും, ഒരു കോഡിനെക്കാൾ എളുപ്പം ഒരു മുഖം കണ്ടെത്താനാണ്.',
    hi: 'आप अपने रिकॉर्ड पर फ़ोटो लगा सकते हैं? हर सूची में आपके मैनेजर को वह दिखती है, और कोड से चेहरा ढूँढना आसान है।',
    te: 'మీ రికార్డుకు ఫోటో పెట్టవచ్చు? ప్రతి జాబితాలోనూ మీ మేనేజర్ దాన్ని చూస్తారు, కోడ్ కంటే ముఖం గుర్తుపట్టడం తేలిక.',
    ta: 'உங்கள் பதிவில் புகைப்படம் சேர்க்கலாம்? ஒவ்வொரு பட்டியலிலும் உங்கள் மேலாளர் அதைப் பார்ப்பார், குறியீட்டை விட முகத்தைக் கண்டுபிடிப்பது எளிது.',
  },
  'tip.rank': {
    en: 'you can see where you stand — in your team and across Cyrix? Nobody sees anybody else\'s score, just your own position.',
    ml: 'നിങ്ങൾ എവിടെ നിൽക്കുന്നു എന്ന് കാണാം — നിങ്ങളുടെ ടീമിലും Cyrix-ൽ ആകെയും? മറ്റാരുടെയും സ്കോർ ആരും കാണില്ല, നിങ്ങളുടെ സ്ഥാനം മാത്രം.',
    hi: 'आप देख सकते हैं कि आप कहाँ खड़े हैं — अपनी टीम में और पूरे Cyrix में? किसी को किसी और का स्कोर नहीं दिखता, बस आपकी अपनी जगह।',
    te: 'మీరు ఎక్కడ ఉన్నారో చూడవచ్చు — మీ టీమ్‌లోనూ Cyrix మొత్తంలోనూ? ఎవరికీ ఇతరుల స్కోరు కనిపించదు, మీ స్థానం మాత్రమే.',
    ta: 'நீங்கள் எங்கே இருக்கிறீர்கள் என்று பார்க்கலாம் — உங்கள் குழுவிலும் Cyrix முழுவதிலும்? யாருக்கும் மற்றவரின் மதிப்பெண் தெரியாது, உங்கள் இடம் மட்டும்.',
  },
  'tip.language': {
    en: 'I speak Malayalam, Hindi, Telugu and Tamil? Change it at the top of this panel — the manual changes with it.',
    ml: 'ഞാൻ മലയാളം, ഹിന്ദി, തെലുങ്ക്, തമിഴ് സംസാരിക്കും? ഈ പാനലിന്റെ മുകളിൽ അത് മാറ്റാം — മാനുവലും അതിനൊപ്പം മാറും.',
    hi: 'मैं मलयालम, हिंदी, तेलुगु और तमिल बोलती हूँ? इस पैनल के ऊपर से बदल लीजिए — मैनुअल भी साथ बदल जाएगा।',
    te: 'నేను మలయాళం, హిందీ, తెలుగు, తమిళం మాట్లాడతాను? ఈ ప్యానెల్ పైన మార్చుకోండి — మాన్యువల్ కూడా దానితో మారుతుంది.',
    ta: 'நான் மலையாளம், இந்தி, தெலுங்கு, தமிழ் பேசுவேன்? இந்தப் பலகத்தின் மேலே மாற்றிக்கொள்ளுங்கள் — கையேடும் அதனுடன் மாறும்.',
  },
  'tip.manual': {
    en: 'the whole manual is one page, in your language? Fifty questions with plain answers — worth ten minutes once.',
    ml: 'മുഴുവൻ മാനുവലും നിങ്ങളുടെ ഭാഷയിൽ ഒരൊറ്റ പേജിലാണ്? അമ്പത് ചോദ്യങ്ങളും ലളിതമായ ഉത്തരങ്ങളും — ഒരിക്കൽ പത്ത് മിനിറ്റ് ചെലവഴിക്കാൻ യോഗ്യം.',
    hi: 'पूरा मैनुअल आपकी भाषा में एक ही पेज पर है? पचास सवाल और सीधे जवाब — एक बार दस मिनट देने लायक।',
    te: 'మొత్తం మాన్యువల్ మీ భాషలో ఒకే పేజీలో ఉంది? యాభై ప్రశ్నలు, సూటి సమాధానాలు — ఒకసారి పది నిమిషాలు పెట్టడం విలువైనది.',
    ta: 'முழு கையேடும் உங்கள் மொழியில் ஒரே பக்கத்தில் உள்ளது? ஐம்பது கேள்விகள், நேரடி பதில்கள் — ஒருமுறை பத்து நிமிடம் செலவழிக்கத் தகுந்தது.',
  },
  'tip.months': {
    en: 'every month of your year is on one screen? Open one to fill it in, or an old one to see what it came to.',
    ml: 'നിങ്ങളുടെ വർഷത്തിലെ എല്ലാ മാസവും ഒരൊറ്റ സ്ക്രീനിലുണ്ട്? പൂരിപ്പിക്കാൻ ഒന്ന് തുറക്കൂ, അല്ലെങ്കിൽ പഴയത് എത്രയായി എന്ന് കാണാൻ.',
    hi: 'आपके साल का हर महीना एक ही स्क्रीन पर है? भरने के लिए कोई खोलिए, या पुराना खोलकर देखिए कि कितना बना।',
    te: 'మీ సంవత్సరంలోని ప్రతి నెలా ఒకే స్క్రీన్‌లో ఉంది? నింపడానికి ఒకటి తెరవండి, లేదా పాతది ఎంత వచ్చిందో చూడండి.',
    ta: 'உங்கள் ஆண்டின் ஒவ்வொரு மாதமும் ஒரே திரையில் உள்ளது? நிரப்ப ஒன்றைத் திறங்கள், அல்லது பழையது எவ்வளவு ஆனது எனப் பாருங்கள்.',
  },
  'tip.query': {
    en: 'you can query a score you disagree with? Tick the rows, say why, and your manager has to answer.',
    ml: 'നിങ്ങൾ യോജിക്കാത്ത ഒരു സ്കോറിനെക്കുറിച്ച് ചോദിക്കാം? വരികൾ ടിക്ക് ചെയ്ത് കാരണം പറയൂ, മാനേജർ മറുപടി പറയണം.',
    hi: 'जिस स्कोर से आप सहमत नहीं, उस पर सवाल उठा सकते हैं? पंक्तियाँ चुनिए, कारण लिखिए — मैनेजर को जवाब देना होगा।',
    te: 'మీరు అంగీకరించని స్కోరుపై ప్రశ్న అడగవచ్చు? వరుసలు ఎంచుకుని కారణం చెప్పండి, మేనేజర్ సమాధానం ఇవ్వాలి.',
    ta: 'நீங்கள் ஒப்புக்கொள்ளாத மதிப்பெண்ணைக் கேள்வி கேட்கலாம்? வரிசைகளைத் தேர்வுசெய்து காரணம் சொல்லுங்கள், மேலாளர் பதிலளிக்க வேண்டும்.',
  },
  'tip.split': {
    en: 'you can see exactly how your KPI is built? Every row, its weightage, its target and how it is scored.',
    ml: 'നിങ്ങളുടെ KPI എങ്ങനെ ഉണ്ടാക്കിയിരിക്കുന്നു എന്ന് കൃത്യമായി കാണാം? ഓരോ വരിയും, അതിന്റെ weightage, ടാർഗറ്റ്, എങ്ങനെ സ്കോർ ചെയ്യുന്നു എന്നതും.',
    hi: 'आप देख सकते हैं कि आपका KPI कैसे बना है? हर पंक्ति, उसका weightage, उसका टारगेट और वह कैसे स्कोर होती है।',
    te: 'మీ KPI ఎలా తయారైందో ఖచ్చితంగా చూడవచ్చు? ప్రతి వరుస, దాని weightage, టార్గెట్, ఎలా స్కోర్ అవుతుందో కూడా.',
    ta: 'உங்கள் KPI எப்படி உருவாக்கப்பட்டுள்ளது என்பதைத் துல்லியமாகப் பார்க்கலாம்? ஒவ்வொரு வரிசையும், அதன் weightage, இலக்கு, எப்படி மதிப்பெண் பெறுகிறது என்பதும்.',
  },
  'tip.alternates': {
    en: 'a KPI row can measure something else in a month where the usual thing does not apply? Same weightage, you pick which.',
    ml: 'സാധാരണ കാര്യം ബാധകമല്ലാത്ത മാസത്തിൽ ഒരു KPI വരിക്ക് മറ്റൊന്ന് അളക്കാനാകും? അതേ weightage, ഏതെന്ന് നിങ്ങൾ തിരഞ്ഞെടുക്കും.',
    hi: 'जिस महीने सामान्य चीज़ लागू न हो, उसमें KPI पंक्ति कुछ और माप सकती है? weightage वही, चुनाव आपका।',
    te: 'సాధారణ విషయం వర్తించని నెలలో ఒక KPI వరుస వేరేదాన్ని కొలవగలదు? weightage అదే, ఏదో మీరు ఎంచుకుంటారు.',
    ta: 'வழக்கமான விஷயம் பொருந்தாத மாதத்தில் ஒரு KPI வரிசை வேறொன்றை அளக்க முடியும்? weightage அதே, எதைத் தேர்வுசெய்வது உங்கள் விருப்பம்.',
  },
  'tip.startmonth': {
    en: 'a KPI can start from the month you joined? You are not asked about months that were never yours.',
    ml: 'നിങ്ങൾ ജോലിക്ക് ചേർന്ന മാസം മുതൽ KPI തുടങ്ങാം? നിങ്ങളുടേതല്ലാത്ത മാസങ്ങളെക്കുറിച്ച് ചോദിക്കില്ല.',
    hi: 'KPI उस महीने से शुरू हो सकता है जब आप जुड़े थे? जो महीने आपके थे ही नहीं, उनके बारे में नहीं पूछा जाता।',
    te: 'మీరు చేరిన నెల నుంచి KPI మొదలవ్వచ్చు? మీవి కాని నెలల గురించి అడగరు.',
    ta: 'நீங்கள் சேர்ந்த மாதத்திலிருந்து KPI தொடங்கலாம்? உங்களுடையதல்லாத மாதங்களைப் பற்றி கேட்கப்படாது.',
  },
  'tip.install': {
    en: 'you can put this on your phone\'s home screen? It opens like an app, no browser in the way.',
    ml: 'ഇത് നിങ്ങളുടെ ഫോണിന്റെ ഹോം സ്ക്രീനിൽ ഇടാം? ഒരു ആപ്പ് പോലെ തുറക്കും, ബ്രൗസർ ഇടയിൽ വരില്ല.',
    hi: 'इसे अपने फ़ोन की होम स्क्रीन पर रख सकते हैं? ऐप की तरह खुलता है, बीच में ब्राउज़र नहीं।',
    te: 'దీన్ని మీ ఫోన్ హోమ్ స్క్రీన్‌లో పెట్టుకోవచ్చు? యాప్‌లా తెరుచుకుంటుంది, మధ్యలో బ్రౌజర్ ఉండదు.',
    ta: 'இதை உங்கள் தொலைபேசியின் முகப்புத் திரையில் வைக்கலாம்? பயன்பாடு போலத் திறக்கும், இடையில் உலாவி இல்லை.',
  },
  'tip.dark': {
    en: 'there is a dark mode? The sun icon at the top of the page switches it, and it remembers.',
    ml: 'ഒരു ഡാർക്ക് മോഡ് ഉണ്ട്? പേജിന്റെ മുകളിലുള്ള സൂര്യന്റെ ചിഹ്നം അത് മാറ്റും, അത് ഓർത്തുവയ്ക്കുകയും ചെയ്യും.',
    hi: 'एक डार्क मोड भी है? पेज के ऊपर सूरज वाले निशान से बदलिए, वह याद भी रखता है।',
    te: 'డార్క్ మోడ్ ఉంది? పేజీ పైన ఉన్న సూర్యుడి గుర్తుతో మార్చండి, అది గుర్తుంచుకుంటుంది కూడా.',
    ta: 'இருண்ட பயன்முறை உள்ளது? பக்கத்தின் மேலுள்ள சூரிய சின்னத்தால் மாற்றுங்கள், அது நினைவிலும் வைத்துக்கொள்ளும்.',
  },
  'tip.support': {
    en: 'you can send a question straight to HR or to Software from here? Type it and pick who it goes to.',
    ml: 'ഇവിടെ നിന്ന് നേരിട്ട് HR-നോ Software-നോ ഒരു ചോദ്യം അയക്കാം? ടൈപ്പ് ചെയ്ത് ആർക്ക് പോകണമെന്ന് തിരഞ്ഞെടുക്കൂ.',
    hi: 'यहीं से सीधे HR या Software को सवाल भेज सकते हैं? लिखिए और चुनिए कि किसे जाए।',
    te: 'ఇక్కడి నుంచే నేరుగా HR కి లేదా Software కి ప్రశ్న పంపవచ్చు? టైప్ చేసి ఎవరికి వెళ్ళాలో ఎంచుకోండి.',
    ta: 'இங்கிருந்தே நேரடியாக HR அல்லது Software க்கு கேள்வி அனுப்பலாம்? தட்டச்சு செய்து யாருக்குச் செல்ல வேண்டும் எனத் தேர்வுசெய்யுங்கள்.',
  },
  'tip.ask': {
    en: 'you can just ask me things? "What was my August score", "which row is weakest", "am I on track".',
    ml: 'നിങ്ങൾക്ക് എന്നോട് നേരിട്ട് ചോദിക്കാം? "എന്റെ ഓഗസ്റ്റ് സ്കോർ എത്ര", "ഏത് വരിയാണ് ദുർബലം", "ഞാൻ ശരിയായ വഴിയിലാണോ".',
    hi: 'आप मुझसे सीधे पूछ सकते हैं? "अगस्त का मेरा स्कोर क्या था", "कौन सी पंक्ति कमज़ोर है", "क्या मैं ठीक चल रहा हूँ"।',
    te: 'మీరు నన్ను నేరుగా అడగవచ్చు? "నా ఆగస్టు స్కోరు ఎంత", "ఏ వరుస బలహీనం", "నేను సరైన దారిలో ఉన్నానా".',
    ta: 'நீங்கள் என்னிடம் நேரடியாகக் கேட்கலாம்? "என் ஆகஸ்ட் மதிப்பெண் என்ன", "எந்த வரிசை பலவீனம்", "நான் சரியான பாதையில் இருக்கிறேனா".',
  },
  'tip.templates': {
    en: 'you can save a KPI as a template for your whole line? Everyone below you can start from it instead of a blank page.',
    ml: 'നിങ്ങളുടെ മുഴുവൻ ലൈനിനും വേണ്ടി ഒരു KPI ടെംപ്ലേറ്റായി സേവ് ചെയ്യാം? നിങ്ങളുടെ കീഴിലുള്ള എല്ലാവർക്കും ശൂന്യമായ പേജിനു പകരം അതിൽ നിന്ന് തുടങ്ങാം.',
    hi: 'आप एक KPI को अपनी पूरी लाइन के लिए टेम्पलेट बना सकते हैं? आपके नीचे हर कोई खाली पेज के बजाय उससे शुरू कर सकता है।',
    te: 'మీ మొత్తం లైన్ కోసం ఒక KPI ని టెంప్లేట్‌గా సేవ్ చేయవచ్చు? మీ కింద ఉన్న అందరూ ఖాళీ పేజీకి బదులు దాని నుంచి మొదలుపెట్టవచ్చు.',
    ta: 'உங்கள் முழு வரிசைக்கும் ஒரு KPI ஐ வார்ப்புருவாகச் சேமிக்கலாம்? உங்களுக்குக் கீழ் உள்ள அனைவரும் காலி பக்கத்திற்குப் பதிலாக அதிலிருந்து தொடங்கலாம்.',
  },
  'tip.analysis': {
    en: 'your team screen draws a bell curve and a trend? It shows where the team sits, not just each person.',
    ml: 'നിങ്ങളുടെ ടീം സ്ക്രീൻ ഒരു ബെൽ കർവും ട്രെൻഡും വരയ്ക്കുന്നു? ഓരോ വ്യക്തിയെയും മാത്രമല്ല, ടീം എവിടെ നിൽക്കുന്നു എന്നും കാണിക്കും.',
    hi: 'आपकी टीम स्क्रीन बेल कर्व और ट्रेंड बनाती है? सिर्फ़ हर व्यक्ति नहीं, पूरी टीम कहाँ है यह दिखता है।',
    te: 'మీ టీమ్ స్క్రీన్ బెల్ కర్వ్ మరియు ట్రెండ్ గీస్తుంది? ప్రతి ఒక్కరినే కాదు, టీమ్ ఎక్కడ ఉందో కూడా చూపిస్తుంది.',
    ta: 'உங்கள் குழுத் திரை மணி வளைவும் போக்கும் வரைகிறது? ஒவ்வொருவரையும் மட்டுமல்ல, குழு எங்கே உள்ளது என்பதையும் காட்டும்.',
  },
  'tip.drill': {
    en: 'you can look into a report\'s own team, and theirs? The whole line below you, not just the first rung.',
    ml: 'നിങ്ങളുടെ കീഴിലുള്ള ഒരാളുടെ ടീമിലേക്കും അവരുടെ ടീമിലേക്കും നോക്കാം? ആദ്യ പടി മാത്രമല്ല, നിങ്ങളുടെ കീഴിലുള്ള മുഴുവൻ ലൈനും.',
    hi: 'आप अपने किसी रिपोर्ट की टीम, और उनकी भी देख सकते हैं? सिर्फ़ पहली सीढ़ी नहीं, आपके नीचे की पूरी लाइन।',
    te: 'మీ కింది వ్యక్తి టీమ్‌నూ, వాళ్ళ టీమ్‌నూ చూడవచ్చు? మొదటి మెట్టు మాత్రమే కాదు, మీ కింద ఉన్న మొత్తం లైన్.',
    ta: 'உங்கள் கீழுள்ள ஒருவரின் குழுவையும், அவர்களுடையதையும் பார்க்கலாம்? முதல் படி மட்டுமல்ல, உங்களுக்குக் கீழ் உள்ள முழு வரிசையும்.',
  },
  'tip.approveall': {
    en: 'you can approve a whole queue of KPIs at once? Each one is still checked for a valid 80 / 20 split.',
    ml: 'ഒരു കൂട്ടം KPI-കൾ ഒരുമിച്ച് അംഗീകരിക്കാം? ഓരോന്നും ശരിയായ 80 / 20 വിഭജനത്തിനായി ഇപ്പോഴും പരിശോധിക്കപ്പെടും.',
    hi: 'आप एक साथ पूरी कतार के KPI मंज़ूर कर सकते हैं? हर एक की 80 / 20 जाँच फिर भी होती है।',
    te: 'మొత్తం క్యూలోని KPI లను ఒకేసారి ఆమోదించవచ్చు? ప్రతి ఒక్కటీ సరైన 80 / 20 విభజన కోసం ఇంకా తనిఖీ అవుతుంది.',
    ta: 'ஒரே நேரத்தில் முழு வரிசை KPI களையும் அங்கீகரிக்கலாம்? ஒவ்வொன்றும் சரியான 80 / 20 பிரிவுக்காக இன்னும் சரிபார்க்கப்படும்.',
  },
  'tip.export': {
    en: 'you can export your team\'s scores to Excel? The month on screen, or the whole year.',
    ml: 'നിങ്ങളുടെ ടീമിന്റെ സ്കോറുകൾ Excel-ലേക്ക് എടുക്കാം? സ്ക്രീനിലുള്ള മാസം, അല്ലെങ്കിൽ വർഷം മുഴുവൻ.',
    hi: 'अपनी टीम के स्कोर Excel में निकाल सकते हैं? स्क्रीन वाला महीना, या पूरा साल।',
    te: 'మీ టీమ్ స్కోర్లను Excel కి ఎగుమతి చేయవచ్చు? స్క్రీన్‌లోని నెల, లేదా మొత్తం సంవత్సరం.',
    ta: 'உங்கள் குழுவின் மதிப்பெண்களை Excel க்கு ஏற்றுமதி செய்யலாம்? திரையில் உள்ள மாதம், அல்லது முழு ஆண்டு.',
  },
  'tip.mgrrank': {
    en: 'managers get a standing of their own? How promptly your team submits, how promptly you score, and how the team is doing.',
    ml: 'മാനേജർമാർക്ക് സ്വന്തമായി ഒരു റാങ്കിംഗ് ഉണ്ട്? നിങ്ങളുടെ ടീം എത്ര വേഗം സമർപ്പിക്കുന്നു, നിങ്ങൾ എത്ര വേഗം സ്കോർ ചെയ്യുന്നു, ടീം എങ്ങനെ പ്രവർത്തിക്കുന്നു എന്നിവ.',
    hi: 'मैनेजरों की अपनी एक रैंकिंग होती है? आपकी टीम कितनी जल्दी जमा करती है, आप कितनी जल्दी स्कोर करते हैं, और टीम कैसा कर रही है।',
    te: 'మేనేజర్లకు వారి సొంత ర్యాంకింగ్ ఉంటుంది? మీ టీమ్ ఎంత త్వరగా సమర్పిస్తుంది, మీరు ఎంత త్వరగా స్కోర్ చేస్తారు, టీమ్ ఎలా ఉంది అన్నవి.',
    ta: 'மேலாளர்களுக்கு அவர்களுக்கே உரிய தரவரிசை உண்டு? உங்கள் குழு எவ்வளவு விரைவாகச் சமர்ப்பிக்கிறது, நீங்கள் எவ்வளவு விரைவாக மதிப்பெண் அளிக்கிறீர்கள், குழு எப்படிச் செயல்படுகிறது என்பவை.',
  },
  'nudge.hi': {
    en: 'Hey {name} — here is where you stand today.',
    ml: 'ഹായ് {name} — ഇന്ന് നിങ്ങൾ എവിടെ നിൽക്കുന്നു എന്നത് ഇതാ.',
    hi: 'नमस्ते {name} — आज आप कहाँ हैं, यह रहा।',
    te: 'హాయ్ {name} — ఈరోజు మీరు ఎక్కడ ఉన్నారో ఇదిగో.',
    ta: 'ஹாய் {name} — இன்று நீங்கள் எங்கே இருக்கிறீர்கள் என்பது இதோ.',
  },
  'nudge.clear': {
    en: 'Hey {name} — nothing needs you right now. All caught up.',
    ml: 'ഹായ് {name} — ഇപ്പോൾ നിങ്ങൾ ചെയ്യാൻ ഒന്നുമില്ല. എല്ലാം കൃത്യമാണ്.',
    hi: 'नमस्ते {name} — अभी आपके लिए कुछ बाकी नहीं है। सब पूरा है।',
    te: 'హాయ్ {name} — ఇప్పుడు మీరు చేయాల్సింది ఏమీ లేదు. అంతా పూర్తయింది.',
    ta: 'ஹாய் {name} — இப்போது நீங்கள் செய்ய எதுவும் இல்லை. எல்லாம் முடிந்துவிட்டது.',
  },
  'nudge.newmonth': {
    en: '{month} is open now — you can fill it in.',
    ml: '{month} ഇപ്പോൾ തുറന്നിരിക്കുന്നു — നിങ്ങൾക്ക് ഇത് പൂരിപ്പിക്കാം.',
    hi: '{month} अब खुला है — आप इसे भर सकते हैं।',
    te: '{month} ఇప్పుడు తెరిచి ఉంది — మీరు దీన్ని పూరించవచ్చు.',
    ta: '{month} இப்போது திறந்துள்ளது — நீங்கள் இதை நிரப்பலாம்.',
  },
  'nudge.draft': {
    en: '{month} is saved as a draft. Finish it and send it to your manager.',
    ml: '{month} ഒരു ഡ്രാഫ്റ്റായി സേവ് ചെയ്തിട്ടുണ്ട്. പൂർത്തിയാക്കി മാനേജർക്ക് അയയ്ക്കുക.',
    hi: '{month} ड्राफ्ट के रूप में सेव है। इसे पूरा करके अपने मैनेजर को भेजें।',
    te: '{month} డ్రాఫ్ట్‌గా సేవ్ అయింది. పూర్తి చేసి మీ మేనేజర్‌కు పంపండి.',
    ta: '{month} வரைவாகச் சேமிக்கப்பட்டுள்ளது. முடித்து உங்கள் மேலாளருக்கு அனுப்புங்கள்.',
  },
  'nudge.kpi': {
    en: 'You have not set up your KPI for this year yet. Nothing can be submitted until it is approved.',
    ml: 'ഈ വർഷത്തെ KPI നിങ്ങൾ ഇതുവരെ സെറ്റ് ചെയ്തിട്ടില്ല. അത് അംഗീകരിക്കുന്നതുവരെ ഒന്നും സമർപ്പിക്കാൻ കഴിയില്ല.',
    hi: 'आपने इस साल का KPI अभी तक नहीं बनाया है। मंज़ूरी मिलने तक कुछ भी नहीं भेजा जा सकता।',
    te: 'ఈ సంవత్సరం KPI ని మీరు ఇంకా సెట్ చేయలేదు. అది ఆమోదం పొందే వరకు ఏదీ సమర్పించలేరు.',
    ta: 'இந்த ஆண்டுக்கான KPI ஐ நீங்கள் இன்னும் அமைக்கவில்லை. அது ஒப்புதல் பெறும் வரை எதுவும் சமர்ப்பிக்க முடியாது.',
  },
  'nudge.rejected': {
    en: 'Your manager sent your KPI back with a reason. Change it and send it again.',
    ml: 'നിങ്ങളുടെ മാനേജർ ഒരു കാരണത്തോടെ KPI തിരികെ അയച്ചു. മാറ്റം വരുത്തി വീണ്ടും അയയ്ക്കുക.',
    hi: 'आपके मैनेजर ने कारण के साथ आपका KPI वापस भेजा है। बदलकर फिर से भेजें।',
    te: 'మీ మేనేజర్ కారణంతో మీ KPI ని తిరిగి పంపారు. మార్చి మళ్లీ పంపండి.',
    ta: 'உங்கள் மேலாளர் ஒரு காரணத்துடன் உங்கள் KPI ஐத் திருப்பி அனுப்பியுள்ளார். மாற்றம் செய்து மீண்டும் அனுப்புங்கள்.',
  },
  'nudge.score': {
    en: '{n} assessment(s) from your team are waiting for you to score.',
    ml: 'നിങ്ങളുടെ ടീമിൽ നിന്ന് {n} വിലയിരുത്തൽ നിങ്ങൾ സ്കോർ ചെയ്യാൻ കാത്തിരിക്കുന്നു.',
    hi: 'आपकी टीम के {n} आकलन आपके स्कोर देने का इंतज़ार कर रहे हैं।',
    te: 'మీ టీమ్ నుండి {n} అంచనాలు మీ స్కోరు కోసం ఎదురుచూస్తున్నాయి.',
    ta: 'உங்கள் குழுவிலிருந்து {n} மதிப்பீடுகள் உங்கள் மதிப்பெண்ணுக்காகக் காத்திருக்கின்றன.',
  },
  'nudge.approve': {
    en: '{n} KPI(s) are waiting for your approval. Nobody can start a month until you approve theirs.',
    ml: '{n} KPI നിങ്ങളുടെ അംഗീകാരത്തിനായി കാത്തിരിക്കുന്നു. നിങ്ങൾ അംഗീകരിക്കുന്നതുവരെ അവർക്ക് ഒരു മാസവും തുടങ്ങാൻ കഴിയില്ല.',
    hi: '{n} KPI आपकी मंज़ूरी का इंतज़ार कर रहे हैं। जब तक आप मंज़ूरी नहीं देते, वे कोई महीना शुरू नहीं कर सकते।',
    te: '{n} KPI లు మీ ఆమోదం కోసం ఎదురుచూస్తున్నాయి. మీరు ఆమోదించే వరకు వారు ఏ నెలనూ మొదలుపెట్టలేరు.',
    ta: '{n} KPI உங்கள் ஒப்புதலுக்காகக் காத்திருக்கின்றன. நீங்கள் ஒப்புதல் அளிக்கும் வரை அவர்கள் எந்த மாதத்தையும் தொடங்க முடியாது.',
  },

  lost: {
    en: 'I do not know that one, {name}. The manual may — or ask your manager.',
    ml: 'അത് എനിക്ക് അറിയില്ല, {name}. മാനുവലിൽ ഉണ്ടാകാം — അല്ലെങ്കിൽ നിങ്ങളുടെ മാനേജറോട് ചോദിക്കുക.',
    hi: 'यह मुझे नहीं पता, {name}। मैनुअल में हो सकता है — या अपने मैनेजर से पूछें।',
    te: 'అది నాకు తెలియదు, {name}. మాన్యువల్‌లో ఉండవచ్చు — లేదా మీ మేనేజర్‌ను అడగండి.',
    ta: 'அது எனக்குத் தெரியாது, {name}. மேனுவலில் இருக்கலாம் — அல்லது உங்கள் மேலாளரிடம் கேளுங்கள்.',
  },

  /*
    When Cyra cannot answer, and a person can.

    This is the honest end of a bot that refuses to guess: it says it does
    not know, and the very next thing it offers is somebody who does. The
    question they already typed becomes the request, so nobody writes it
    twice.
  */
  'sup.mode': {
    en: 'Writing to {desk}. Send it as it is, or change it first.',
    ml: '{desk}-ന് എഴുതുന്നു. ഇതേപടി അയയ്ക്കുക, അല്ലെങ്കിൽ ആദ്യം മാറ്റുക.',
    hi: '{desk} को लिख रहे हैं। ऐसे ही भेजें, या पहले बदल लें।',
    te: '{desk} కు రాస్తున్నారు. ఇలాగే పంపండి, లేదా ముందు మార్చండి.',
    ta: '{desk} க்கு எழுதுகிறீர்கள். இப்படியே அனுப்புங்கள், அல்லது முதலில் மாற்றுங்கள்.',
  },
  'sup.sent': {
    en: 'Sent to {desk}. Their answer will be under Contact support on your profile.',
    ml: '{desk}-ന് അയച്ചു. അവരുടെ മറുപടി നിങ്ങളുടെ പ്രൊഫൈലിലെ Contact support-ൽ ഉണ്ടാകും.',
    hi: '{desk} को भेज दिया। उनका जवाब आपकी प्रोफ़ाइल पर Contact support में मिलेगा।',
    te: '{desk} కు పంపాం. వారి సమాధానం మీ ప్రొఫైల్‌లోని Contact support లో ఉంటుంది.',
    ta: '{desk} க்கு அனுப்பப்பட்டது. அவர்களின் பதில் உங்கள் சுயவிவரத்தில் Contact support இல் இருக்கும்.',
  },
  'sup.failed': {
    en: 'That did not send. {why}',
    ml: 'അത് അയയ്ക്കാൻ കഴിഞ്ഞില്ല. {why}',
    hi: 'यह नहीं भेजा जा सका। {why}',
    te: 'అది పంపబడలేదు. {why}',
    ta: 'அதை அனுப்ப முடியவில்லை. {why}',
  },

  manual: {
    en: 'The manual is one short page about your own login — what to do each month, and when.',
    ml: 'മാനുവൽ എന്നത് നിങ്ങളുടെ ലോഗിനെക്കുറിച്ചുള്ള ഒരു ചെറിയ പേജാണ് — ഓരോ മാസവും എന്ത് ചെയ്യണം, എപ്പോൾ ചെയ്യണം.',
    hi: 'मैनुअल आपके अपने लॉगिन के बारे में एक छोटा पृष्ठ है — हर महीने क्या करना है, और कब।',
    te: 'మాన్యువల్ అనేది మీ లాగిన్ గురించిన ఒక చిన్న పేజీ — ప్రతి నెలా ఏమి చేయాలి, ఎప్పుడు చేయాలి.',
    ta: 'மேனுவல் என்பது உங்கள் சொந்த லாகின் பற்றிய ஒரு சிறிய பக்கம் — ஒவ்வொரு மாதமும் என்ன செய்ய வேண்டும், எப்போது செய்ய வேண்டும்.',
  },

  /*
   * ---- who the bot is ------------------------------------------
   *
   * Named, because "who are you" is one of the first things anybody
   * types into a chat window and "I do not know that one" is a poor
   * first impression. Cyra is what the assistant is called in BEMMP
   * too — one name across the modules, like the mark and the toggle.
   *
   * The second sentence is the honest part. It answers from the manual
   * and from figures already on the screen; saying so sets the
   * expectation that it will decline rather than invent, which is the
   * whole design of this thing.
   */
  whoisbot: {
    en: 'I am Cyra, the Cyrix assistant. I answer from the KPI manual and from your own figures — I do not guess.',
    ml: 'ഞാൻ Cyra ആണ്, Cyrix അസിസ്റ്റന്റ്. KPI മാനുവലിൽ നിന്നും നിങ്ങളുടെ സ്വന്തം കണക്കുകളിൽ നിന്നുമാണ് ഞാൻ ഉത്തരം നൽകുന്നത് — ഞാൻ ഊഹിക്കില്ല.',
    hi: 'मैं Cyra हूँ, Cyrix सहायक। मैं KPI मैनुअल और आपके अपने आँकड़ों से उत्तर देती हूँ — मैं अनुमान नहीं लगाती।',
    te: 'నేను Cyra, Cyrix సహాయకి. నేను KPI మాన్యువల్ నుండి, మీ స్వంత లెక్కల నుండి సమాధానం ఇస్తాను — నేను ఊహించను.',
    ta: 'நான் Cyra, Cyrix உதவியாளர். KPI மேனுவலிலிருந்தும் உங்கள் சொந்த எண்களிலிருந்தும் பதில் சொல்கிறேன் — நான் ஊகிப்பதில்லை.',
  },

  // ---- who am I ------------------------------------------------
  whoami: {
    en: 'You are {name}, employee code {ecode}.',
    ml: 'നിങ്ങൾ {name} ആണ്, employee code {ecode}.',
    hi: 'आप {name} हैं, employee code {ecode}।',
    te: 'మీరు {name}, employee code {ecode}.',
    ta: 'நீங்கள் {name}, ஊழியர் குறியீடு {ecode}.',
  },

  // ---- one month -----------------------------------------------
  'month.scored': {
    en: '{month} came to {score} out of 100 — {band}.',
    ml: '{month} മാസത്തെ സ്കോർ 100-ൽ {score} ആണ് — {band}.',
    hi: '{month} में आपका स्कोर 100 में से {score} रहा — {band}।',
    te: '{month} నెలలో మీ స్కోర్ 100కి {score} — {band}.',
    ta: '{month} 100 இல் {score} ஆக வந்தது — {band}.',
  },
  'month.none': {
    en: '{month} has not been assessed. Nothing was submitted for it.',
    ml: '{month} മാസം വിലയിരുത്തിയിട്ടില്ല. അതിന് ഒന്നും സമർപ്പിച്ചിട്ടില്ല.',
    hi: '{month} का मूल्यांकन नहीं हुआ है। उसके लिए कुछ भी जमा नहीं किया गया।',
    te: '{month} నెల మదింపు జరగలేదు. దాని కోసం ఏమీ సమర్పించలేదు.',
    ta: '{month} மதிப்பிடப்படவில்லை. அதற்கு எதுவும் சமர்ப்பிக்கப்படவில்லை.',
  },
  'month.waiting': {
    en: '{month} is with your manager and has not been scored yet.',
    ml: '{month} മാസം നിങ്ങളുടെ മാനേജറുടെ അടുത്താണ്, ഇതുവരെ സ്കോർ ചെയ്തിട്ടില്ല.',
    hi: '{month} आपके मैनेजर के पास है और अभी तक स्कोर नहीं हुआ है।',
    te: '{month} మీ మేనేజర్ వద్ద ఉంది, ఇంకా స్కోర్ చేయలేదు.',
    ta: '{month} உங்கள் மேலாளரிடம் உள்ளது, இன்னும் மதிப்பெண் அளிக்கப்படவில்லை.',
  },
  'month.draft': {
    en: '{month} is still a draft — it has not been sent in yet.',
    ml: '{month} ഇപ്പോഴും draft ആണ് — ഇതുവരെ അയച്ചിട്ടില്ല.',
    hi: '{month} अभी भी draft है — अभी तक भेजा नहीं गया है।',
    te: '{month} ఇంకా draft లోనే ఉంది — ఇంకా పంపలేదు.',
    ta: '{month} இன்னும் வரைவாகவே உள்ளது — இன்னும் அனுப்பப்படவில்லை.',
  },

  // ---- the year ------------------------------------------------
  year: {
    en: 'Your FY {fy} average is {avg} across {n} scored month(s) — {band}.',
    ml: 'FY {fy}-ലെ നിങ്ങളുടെ ശരാശരി {avg} ആണ്, {n} മാസത്തെ സ്കോർ അടിസ്ഥാനമാക്കി — {band}.',
    hi: 'FY {fy} में आपका औसत {avg} है, {n} महीनों के स्कोर पर — {band}।',
    te: 'FY {fy}లో మీ సగటు {avg}, {n} నెలల స్కోర్ ఆధారంగా — {band}.',
    ta: 'உங்கள் FY {fy} சராசரி {avg}, மதிப்பெண் பெற்ற {n} மாதங்களில் — {band}.',
  },
  'year.none': {
    en: 'Nothing has been scored yet this year, so there is no average to show.',
    ml: 'ഈ വർഷം ഇതുവരെ ഒന്നും സ്കോർ ചെയ്തിട്ടില്ല, അതിനാൽ ശരാശരി കാണിക്കാനില്ല.',
    hi: 'इस वर्ष अभी तक कुछ भी स्कोर नहीं हुआ है, इसलिए कोई औसत नहीं है।',
    te: 'ఈ సంవత్సరం ఇంకా ఏమీ స్కోర్ కాలేదు, కాబట్టి సగటు చూపడానికి లేదు.',
    ta: 'இந்த ஆண்டு இன்னும் எதற்கும் மதிப்பெண் அளிக்கப்படவில்லை, எனவே சராசரி எதுவும் இல்லை.',
  },
  split: {
    en: 'On average this year: {parts}.',
    ml: 'ഈ വർഷത്തെ ശരാശരി: {parts}.',
    hi: 'इस वर्ष का औसत: {parts}।',
    te: 'ఈ సంవత్సరం సగటు: {parts}.',
    ta: 'இந்த ஆண்டு சராசரியாக: {parts}.',
  },
  months: {
    en: '{done} month(s) scored so far.',
    ml: 'ഇതുവരെ {done} മാസം സ്കോർ ചെയ്തു.',
    hi: 'अब तक {done} महीने स्कोर हुए हैं।',
    te: 'ఇప్పటివరకు {done} నెలలు స్కోర్ అయ్యాయి.',
    ta: 'இதுவரை {done} மாதங்களுக்கு மதிப்பெண் அளிக்கப்பட்டுள்ளது.',
  },
  'months.open': {
    en: '{done} month(s) scored so far, and {open} still with you or your manager.',
    ml: 'ഇതുവരെ {done} മാസം സ്കോർ ചെയ്തു, {open} മാസം ഇപ്പോഴും നിങ്ങളുടെയോ മാനേജറുടെയോ അടുത്താണ്.',
    hi: 'अब तक {done} महीने स्कोर हुए, और {open} अभी भी आपके या आपके मैनेजर के पास हैं।',
    te: 'ఇప్పటివరకు {done} నెలలు స్కోర్ అయ్యాయి, {open} ఇంకా మీ లేదా మీ మేనేజర్ వద్ద ఉన్నాయి.',
    ta: 'இதுவரை {done} மாதங்களுக்கு மதிப்பெண் அளிக்கப்பட்டுள்ளது, {open} மாதங்கள் இன்னும் உங்களிடம் அல்லது உங்கள் மேலாளரிடம் உள்ளன.',
  },
  bestworst: {
    en: 'Your best month is {best} ({bestScore}) and your lowest is {worst} ({worstScore}).',
    ml: 'നിങ്ങളുടെ ഏറ്റവും മികച്ച മാസം {best} ({bestScore}), ഏറ്റവും കുറഞ്ഞത് {worst} ({worstScore}).',
    hi: 'आपका सबसे अच्छा महीना {best} ({bestScore}) है और सबसे कम {worst} ({worstScore}) है।',
    te: 'మీ ఉత్తమ నెల {best} ({bestScore}), అత్యల్పం {worst} ({worstScore}).',
    ta: 'உங்கள் சிறந்த மாதம் {best} ({bestScore}), குறைந்த மாதம் {worst} ({worstScore}).',
  },
  'bestworst.none': {
    en: 'Nothing has been scored yet this year.',
    ml: 'ഈ വർഷം ഇതുവരെ ഒന്നും സ്കോർ ചെയ്തിട്ടില്ല.',
    hi: 'इस वर्ष अभी तक कुछ भी स्कोर नहीं हुआ है।',
    te: 'ఈ సంవత్సరం ఇంకా ఏమీ స్కోర్ కాలేదు.',
    ta: 'இந்த ஆண்டு இன்னும் எதற்கும் மதிப்பெண் அளிக்கப்படவில்லை.',
  },

  // ---- one row of the KPI, not the block it sits in ---------------
  'kra.weakest': {
    en: 'Your weakest row is {kra} at {pct}% of its {weightage}% — {band}. Strongest is {best} at {bestPct}%.',
    ml: 'ഏറ്റവും ദുർബലമായ വരി {kra} ആണ് — അതിന്റെ {weightage}%-ൽ {pct}%, {band}. ഏറ്റവും മികച്ചത് {best} ({bestPct}%).',
    hi: 'आपकी सबसे कमज़ोर पंक्ति {kra} है — उसके {weightage}% में से {pct}%, {band}। सबसे मज़बूत {best} ({bestPct}%)।',
    te: 'మీ బలహీన వరుస {kra} — దాని {weightage}%లో {pct}%, {band}. బలమైనది {best} ({bestPct}%).',
    ta: 'உங்கள் பலவீனமான வரிசை {kra}, அதன் {weightage}% இல் {pct}% — {band}. மிகச் சிறந்தது {best}, {bestPct}%.',
  },
  'kra.best': {
    en: 'Your strongest row is {kra} at {pct}% of its {weightage}% — {band}.',
    ml: 'ഏറ്റവും മികച്ച വരി {kra} ആണ് — അതിന്റെ {weightage}%-ൽ {pct}%, {band}.',
    hi: 'आपकी सबसे मज़बूत पंक्ति {kra} है — उसके {weightage}% में से {pct}%, {band}।',
    te: 'మీ బలమైన వరుస {kra} — దాని {weightage}%లో {pct}%, {band}.',
    ta: 'உங்கள் மிகச் சிறந்த வரிசை {kra}, அதன் {weightage}% இல் {pct}% — {band}.',
  },
  'kra.declining': {
    en: '{kra} is falling — {from}% earlier in the year, {to}% lately.',
    ml: '{kra} കുറയുന്നു — വർഷത്തിന്റെ തുടക്കത്തിൽ {from}%, അടുത്തിടെ {to}%.',
    hi: '{kra} गिर रहा है — वर्ष की शुरुआत में {from}%, हाल में {to}%।',
    te: '{kra} తగ్గుతోంది — సంవత్సర ఆరంభంలో {from}%, ఇటీవల {to}%.',
    ta: '{kra} குறைந்து வருகிறது — ஆண்டின் தொடக்கத்தில் {from}%, சமீபத்தில் {to}%.',
  },
  'kra.steady': {
    en: 'Nothing is falling. The lowest is {kra} at {pct}%, and it is not dropping.',
    ml: 'ഒന്നും കുറയുന്നില്ല. ഏറ്റവും കുറവ് {kra} ({pct}%), അത് കുറയുന്നുമില്ല.',
    hi: 'कुछ भी नहीं गिर रहा। सबसे कम {kra} ({pct}%) है, और वह गिर नहीं रहा।',
    te: 'ఏదీ తగ్గడం లేదు. అత్యల్పం {kra} ({pct}%), అది తగ్గడం లేదు.',
    ta: 'எதுவும் குறையவில்லை. குறைந்தது {kra}, {pct}%, அது குறையவும் இல்லை.',
  },
  'kra.none': {
    en: 'No month has been scored yet, so there is nothing to compare.',
    ml: 'ഇതുവരെ ഒരു മാസവും സ്കോർ ചെയ്തിട്ടില്ല, താരതമ്യം ചെയ്യാൻ ഒന്നുമില്ല.',
    hi: 'अभी तक कोई महीना स्कोर नहीं हुआ, तुलना करने के लिए कुछ नहीं है।',
    te: 'ఇంకా ఏ నెలా స్కోర్ కాలేదు, పోల్చడానికి ఏమీ లేదు.',
    ta: 'இன்னும் எந்த மாதத்திற்கும் மதிப்பெண் அளிக்கப்படவில்லை, எனவே ஒப்பிட எதுவும் இல்லை.',
  },
  /*
    Where the year is heading, and what to do about it.

    Warmer than the figures around them on purpose. Everything else here
    reports something that already happened, where plainness is the whole
    virtue; these two are the answers somebody came looking for when they
    are worried, and a bare decimal in reply to "am I going to be alright"
    is technically responsive and no help at all.

    The hedging is in the words rather than the arithmetic. "If the last
    few months are anything to go by" is the honest description of what
    the number is, and it stops a projection being read as a promise —
    which matters, because this figure will be quoted back at somebody's
    appraisal.
  */
  'forecast.tooearly': {
    en: 'Too early to say — one scored month cannot tell us much about twelve. Ask me again once a couple more are marked.',
    ml: 'ഇപ്പോൾ പറയാൻ നേരമായില്ല — സ്കോർ ചെയ്ത ഒരു മാസം കൊണ്ട് പന്ത്രണ്ട് മാസത്തെക്കുറിച്ച് അധികമൊന്നും പറയാനാവില്ല. രണ്ട് മാസം കൂടി കഴിഞ്ഞ് വീണ്ടും ചോദിക്കൂ.',
    hi: 'अभी कहना जल्दबाज़ी होगी — एक स्कोर किया हुआ महीना बारह महीनों के बारे में ज़्यादा नहीं बता सकता। दो महीने और हो जाएँ, तब फिर पूछिए।',
    te: 'ఇప్పుడే చెప్పలేం — స్కోర్ అయిన ఒక నెల పన్నెండు నెలల గురించి పెద్దగా చెప్పలేదు. మరో రెండు నెలలు అయ్యాక మళ్ళీ అడగండి.',
    ta: 'இப்போது சொல்ல முடியாது — மதிப்பெண் பெற்ற ஒரு மாதம் பன்னிரண்டு மாதங்களைப் பற்றி அதிகம் சொல்லாது. இன்னும் இரண்டு மாதங்கள் கழித்து மீண்டும் கேளுங்கள்.',
  },
  'forecast.low': {
    en: 'Only {scored} months in, so treat this lightly: you are averaging {soFar}, and at that rate the year lands near {projected} — {band}.',
    ml: '{scored} മാസം മാത്രമേ ആയിട്ടുള്ളൂ, അതിനാൽ ഇത് ഉറപ്പായി എടുക്കരുത്: നിങ്ങളുടെ ശരാശരി {soFar} ആണ്, ഈ നിലയിൽ പോയാൽ വർഷം {projected}-ന് അടുത്ത് എത്തും — {band}.',
    hi: 'अभी सिर्फ़ {scored} महीने हुए हैं, इसलिए इसे हल्के में लें: आपका औसत {soFar} है, और इसी रफ़्तार से साल {projected} के आसपास रहेगा — {band}।',
    te: 'ఇంకా {scored} నెలలే అయ్యాయి, కాబట్టి దీన్ని గట్టిగా తీసుకోవద్దు: మీ సగటు {soFar}, ఇదే వేగంతో సంవత్సరం {projected} దగ్గర ముగుస్తుంది — {band}.',
    ta: 'இன்னும் {scored} மாதங்களே ஆகியுள்ளன, எனவே இதை உறுதியாக எடுக்க வேண்டாம்: உங்கள் சராசரி {soFar}, இதே வேகத்தில் ஆண்டு {projected} அருகில் முடியும் — {band}.',
  },
  'forecast.flat': {
    en: 'You are steady — averaging {soFar} across {scored} months. Keep that up over the {remaining} still to come and the year finishes around {projected} — {band}.',
    ml: 'നിങ്ങൾ സ്ഥിരതയോടെയാണ് — {scored} മാസത്തിൽ ശരാശരി {soFar}. ബാക്കിയുള്ള {remaining} മാസവും ഇങ്ങനെ പോയാൽ വർഷം {projected}-ന് അടുത്ത് അവസാനിക്കും — {band}.',
    hi: 'आप स्थिर हैं — {scored} महीनों में औसत {soFar}। बाकी {remaining} महीनों में भी यही रफ़्तार रही तो साल {projected} के आसपास पूरा होगा — {band}।',
    te: 'మీరు స్థిరంగా ఉన్నారు — {scored} నెలల్లో సగటు {soFar}. మిగిలిన {remaining} నెలల్లోనూ ఇదే కొనసాగితే సంవత్సరం {projected} దగ్గర ముగుస్తుంది — {band}.',
    ta: 'நீங்கள் நிலையாக இருக்கிறீர்கள் — {scored} மாதங்களில் சராசரி {soFar}. மீதமுள்ள {remaining} மாதங்களிலும் இதே தொடர்ந்தால் ஆண்டு {projected} அளவில் முடியும் — {band}.',
  },
  'forecast.up': {
    en: 'You are climbing — {soFar} across the year but {recent} lately. If the last few months are anything to go by, you finish near {projected} — {band}.',
    ml: 'നിങ്ങൾ മെച്ചപ്പെടുകയാണ് — വർഷം മുഴുവൻ {soFar}, പക്ഷേ അടുത്തിടെ {recent}. കഴിഞ്ഞ ഏതാനും മാസങ്ങൾ വെച്ച് നോക്കിയാൽ നിങ്ങൾ {projected}-ന് അടുത്ത് എത്തും — {band}.',
    hi: 'आप ऊपर जा रहे हैं — साल भर में {soFar}, लेकिन हाल में {recent}। पिछले कुछ महीनों को देखें तो आप {projected} के करीब पहुँचेंगे — {band}।',
    te: 'మీరు మెరుగవుతున్నారు — ఏడాది మొత్తం {soFar}, కానీ ఇటీవల {recent}. గత కొన్ని నెలలను బట్టి చూస్తే మీరు {projected} దగ్గరకు చేరుతారు — {band}.',
    ta: 'நீங்கள் முன்னேறுகிறீர்கள் — ஆண்டு முழுவதும் {soFar}, ஆனால் சமீபத்தில் {recent}. கடந்த சில மாதங்களை வைத்துப் பார்த்தால் நீங்கள் {projected} அருகில் முடிப்பீர்கள் — {band}.',
  },
  'forecast.down': {
    en: 'Worth a look — {soFar} across the year but {recent} lately. If that carries on the year settles near {projected} — {band}. There are {remaining} months left to turn it around.',
    ml: 'ശ്രദ്ധിക്കേണ്ടതുണ്ട് — വർഷം മുഴുവൻ {soFar}, പക്ഷേ അടുത്തിടെ {recent}. ഇത് തുടർന്നാൽ വർഷം {projected}-ന് അടുത്ത് നിൽക്കും — {band}. തിരിച്ചുവരാൻ {remaining} മാസം ബാക്കിയുണ്ട്.',
    hi: 'ध्यान देने लायक है — साल भर में {soFar}, लेकिन हाल में {recent}। यही चलता रहा तो साल {projected} के आसपास रहेगा — {band}। सुधारने के लिए {remaining} महीने बाकी हैं।',
    te: 'గమనించాల్సిన విషయం — ఏడాది మొత్తం {soFar}, కానీ ఇటీవల {recent}. ఇదే కొనసాగితే సంవత్సరం {projected} దగ్గర ఉంటుంది — {band}. సరిచేసుకోవడానికి {remaining} నెలలు ఉన్నాయి.',
    ta: 'கவனிக்க வேண்டியது — ஆண்டு முழுவதும் {soFar}, ஆனால் சமீபத்தில் {recent}. இது தொடர்ந்தால் ஆண்டு {projected} அளவில் நிற்கும் — {band}. திருத்திக்கொள்ள {remaining} மாதங்கள் உள்ளன.',
  },
  'forecast.done': {
    en: 'The year is complete — {scored} months scored, averaging {soFar} — {band}.',
    ml: 'വർഷം പൂർത്തിയായി — {scored} മാസം സ്കോർ ചെയ്തു, ശരാശരി {soFar} — {band}.',
    hi: 'साल पूरा हो गया — {scored} महीने स्कोर हुए, औसत {soFar} — {band}।',
    te: 'సంవత్సరం పూర్తయింది — {scored} నెలలు స్కోర్ అయ్యాయి, సగటు {soFar} — {band}.',
    ta: 'ஆண்டு முடிந்தது — {scored} மாதங்கள் மதிப்பெண் பெற்றன, சராசரி {soFar} — {band}.',
  },
  'lever': {
    en: 'If you pick one thing, make it {kra}. It is worth {weightage}% and running at {pct}% of that — getting it to {target}% would add about {gain} to your total, more than any other row.',
    ml: 'ഒരു കാര്യം മാത്രം എടുക്കുകയാണെങ്കിൽ അത് {kra} ആകട്ടെ. ഇതിന് {weightage}% വിലയുണ്ട്, ഇപ്പോൾ അതിന്റെ {pct}% ആണ് — {target}% വരെ എത്തിച്ചാൽ നിങ്ങളുടെ ആകെ സ്കോറിൽ ഏകദേശം {gain} കൂടും, മറ്റേതൊരു വരിയേക്കാളും കൂടുതൽ.',
    hi: 'अगर एक ही चीज़ चुननी हो तो {kra} चुनिए। यह {weightage}% की है और अभी उसका {pct}% चल रही है — इसे {target}% तक ले जाने से आपके कुल स्कोर में करीब {gain} जुड़ेंगे, किसी भी दूसरी पंक्ति से ज़्यादा।',
    te: 'ఒకే ఒక దానిపై దృష్టి పెట్టాలంటే {kra} తీసుకోండి. దీని విలువ {weightage}%, ప్రస్తుతం అందులో {pct}% ఉంది — దీన్ని {target}% కి తీసుకెళ్తే మీ మొత్తం స్కోరుకు సుమారు {gain} కలుస్తుంది, మిగతా ఏ వరుస కంటే ఎక్కువ.',
    ta: 'ஒரே ஒன்றைத் தேர்ந்தெடுக்க வேண்டுமானால் {kra} ஐ எடுங்கள். இதன் மதிப்பு {weightage}%, தற்போது அதில் {pct}% உள்ளது — இதை {target}% க்கு கொண்டு சென்றால் உங்கள் மொத்த மதிப்பெண்ணில் சுமார் {gain} சேரும், வேறு எந்த வரிசையையும் விட அதிகம்.',
  },
  'lever.none': {
    en: 'Nothing obvious to push on — every row is at 90% of its weightage or better. That is a good place to be.',
    ml: 'പ്രത്യേകിച്ച് ഒന്നും ചെയ്യാനില്ല — എല്ലാ വരികളും അതിന്റെ weightage-ന്റെ 90% അല്ലെങ്കിൽ അതിലധികമാണ്. ഇത് നല്ല അവസ്ഥയാണ്.',
    hi: 'कुछ खास सुधारने को नहीं है — हर पंक्ति अपने weightage के 90% या उससे ऊपर है। यह अच्छी स्थिति है।',
    te: 'ప్రత్యేకంగా చేయాల్సింది ఏమీ లేదు — ప్రతి వరుసా దాని weightage లో 90% లేదా అంతకంటే ఎక్కువ ఉంది. ఇది మంచి స్థితి.',
    ta: 'குறிப்பாக மேம்படுத்த ஒன்றும் இல்லை — ஒவ்வொரு வரிசையும் அதன் weightage இல் 90% அல்லது அதற்கு மேல் உள்ளது. இது நல்ல நிலை.',
  },
  'core.weakest': {
    en: 'Your lowest core value is {name}, averaging {pct} out of 100.',
    ml: 'ഏറ്റവും കുറഞ്ഞ core value {name} ആണ്, ശരാശരി 100-ൽ {pct}.',
    hi: 'आपका सबसे कम core value {name} है, औसत 100 में से {pct}।',
    te: 'మీ అత్యల్ప core value {name}, సగటు 100కి {pct}.',
    ta: 'உங்கள் குறைந்த core value {name}, சராசரியாக 100 இல் {pct}.',
  },
  'core.declining': {
    en: '{name} is slipping — {from} earlier in the year, {to} lately.',
    ml: '{name} കുറയുന്നു — വർഷത്തിന്റെ തുടക്കത്തിൽ {from}, അടുത്തിടെ {to}.',
    hi: '{name} गिर रहा है — वर्ष की शुरुआत में {from}, हाल में {to}।',
    te: '{name} తగ్గుతోంది — సంవత్సర ఆరంభంలో {from}, ఇటీవల {to}.',
    ta: '{name} சரிந்து வருகிறது — ஆண்டின் தொடக்கத்தில் {from}, சமீபத்தில் {to}.',
  },
  'core.steady': {
    en: 'No core value is slipping. The lowest is {name} at {pct} out of 100.',
    ml: 'ഒരു core value-ഉം കുറയുന്നില്ല. ഏറ്റവും കുറവ് {name} (100-ൽ {pct}).',
    hi: 'कोई core value नहीं गिर रहा। सबसे कम {name} (100 में से {pct}) है।',
    te: 'ఏ core value తగ్గడం లేదు. అత్యల్పం {name} (100కి {pct}).',
    ta: 'எந்த core value ம் சரியவில்லை. குறைந்தது {name}, 100 இல் {pct}.',
  },
  'core.none': {
    en: 'No core value ratings yet this year.',
    ml: 'ഈ വർഷം ഇതുവരെ core value റേറ്റിംഗുകൾ ഇല്ല.',
    hi: 'इस वर्ष अभी तक कोई core value रेटिंग नहीं है।',
    te: 'ఈ సంవత్సరం ఇంకా core value రేటింగ్‌లు లేవు.',
    ta: 'இந்த ஆண்டு இன்னும் core value மதிப்பீடுகள் இல்லை.',
  },

  // ---- the KPI itself -------------------------------------------
  'kpi.active': {
    en: 'Your KPI is approved and in force for the year.',
    ml: 'നിങ്ങളുടെ KPI അംഗീകരിച്ചു, ഈ വർഷത്തേക്ക് പ്രാബല്യത്തിലാണ്.',
    hi: 'आपका KPI स्वीकृत है और इस वर्ष के लिए लागू है।',
    te: 'మీ KPI ఆమోదించబడింది, ఈ సంవత్సరానికి అమలులో ఉంది.',
    ta: 'உங்கள் KPI ஒப்புதல் பெற்று இந்த ஆண்டுக்கு அமலில் உள்ளது.',
  },
  'kpi.pending': {
    en: 'Your KPI is with your manager, waiting to be approved.',
    ml: 'നിങ്ങളുടെ KPI മാനേജറുടെ അടുത്താണ്, അംഗീകാരത്തിനായി കാത്തിരിക്കുന്നു.',
    hi: 'आपका KPI आपके मैनेजर के पास है, स्वीकृति की प्रतीक्षा में।',
    te: 'మీ KPI మీ మేనేజర్ వద్ద ఉంది, ఆమోదం కోసం వేచి ఉంది.',
    ta: 'உங்கள் KPI உங்கள் மேலாளரிடம் உள்ளது, ஒப்புதலுக்காகக் காத்திருக்கிறது.',
  },
  'kpi.rejected': {
    en: 'Your manager sent your KPI back. Open My KPI to see why, change it and send it again.',
    ml: 'നിങ്ങളുടെ മാനേജർ KPI തിരികെ അയച്ചു. കാരണം കാണാൻ My KPI തുറക്കുക, മാറ്റി വീണ്ടും അയക്കുക.',
    hi: 'आपके मैनेजर ने आपका KPI वापस भेजा है। कारण देखने के लिए My KPI खोलें, बदलें और फिर से भेजें।',
    te: 'మీ మేనేజర్ మీ KPIని వెనక్కి పంపారు. కారణం చూడటానికి My KPI తెరవండి, మార్చి మళ్లీ పంపండి.',
    ta: 'உங்கள் மேலாளர் உங்கள் KPI ஐத் திருப்பி அனுப்பியுள்ளார். ஏன் என்று பார்க்க My KPI ஐத் திறங்கள், மாற்றம் செய்து மீண்டும் அனுப்புங்கள்.',
  },
  'kpi.draft': {
    en: 'Your KPI is still a draft. Finish it and send it to your manager.',
    ml: 'നിങ്ങളുടെ KPI ഇപ്പോഴും draft ആണ്. പൂർത്തിയാക്കി മാനേജർക്ക് അയക്കുക.',
    hi: 'आपका KPI अभी भी draft है। इसे पूरा करके अपने मैनेजर को भेजें।',
    te: 'మీ KPI ఇంకా draft లోనే ఉంది. పూర్తి చేసి మీ మేనేజర్‌కు పంపండి.',
    ta: 'உங்கள் KPI இன்னும் வரைவாகவே உள்ளது. முடித்து உங்கள் மேலாளருக்கு அனுப்புங்கள்.',
  },
  'kpi.none': {
    en: 'You have not set up a KPI for this year yet.',
    ml: 'ഈ വർഷത്തേക്ക് നിങ്ങൾ ഇതുവരെ KPI സെറ്റ് ചെയ്തിട്ടില്ല.',
    hi: 'आपने इस वर्ष के लिए अभी तक KPI सेट नहीं किया है।',
    te: 'ఈ సంవత్సరానికి మీరు ఇంకా KPI సెట్ చేయలేదు.',
    ta: 'இந்த ஆண்டுக்கு நீங்கள் இன்னும் KPI அமைக்கவில்லை.',
  },

  // ---- a manager's team ------------------------------------------
  'team.size': {
    en: '{n} people report to you.',
    ml: '{n} പേർ നിങ്ങൾക്ക് കീഴിൽ റിപ്പോർട്ട് ചെയ്യുന്നു.',
    hi: '{n} लोग आपको रिपोर्ट करते हैं।',
    te: '{n} మంది మీకు రిపోర్ట్ చేస్తారు.',
    ta: '{n} பேர் உங்களிடம் அறிக்கை செய்கிறார்கள்.',
  },
  'team.average': {
    en: 'Your team averaged {avg} {scope}, across {n} people — {band}.',
    ml: 'നിങ്ങളുടെ ടീമിന്റെ ശരാശരി {scope} {avg} ആണ്, {n} പേരുടെ അടിസ്ഥാനത്തിൽ — {band}.',
    hi: 'आपकी टीम का औसत {scope} {avg} है, {n} लोगों पर — {band}।',
    te: 'మీ టీమ్ సగటు {scope} {avg}, {n} మంది ఆధారంగా — {band}.',
    ta: 'உங்கள் குழு {scope} சராசரியாக {avg}, {n} பேரில் — {band}.',
  },
  'team.lowest': {
    en: 'Lowest {scope}: {name} ({ecode}) at {score} — {band}.',
    ml: 'ഏറ്റവും കുറവ് {scope}: {name} ({ecode}) — {score}, {band}.',
    hi: 'सबसे कम {scope}: {name} ({ecode}) — {score}, {band}।',
    te: 'అత్యల్పం {scope}: {name} ({ecode}) — {score}, {band}.',
    ta: '{scope} குறைந்தது: {name} ({ecode}) {score} — {band}.',
  },
  'team.highest': {
    en: 'Highest {scope}: {name} ({ecode}) at {score} — {band}.',
    ml: 'ഏറ്റവും ഉയർന്നത് {scope}: {name} ({ecode}) — {score}, {band}.',
    hi: 'सबसे अधिक {scope}: {name} ({ecode}) — {score}, {band}।',
    te: 'అత్యధికం {scope}: {name} ({ecode}) — {score}, {band}.',
    ta: '{scope} அதிகபட்சம்: {name} ({ecode}) {score} — {band}.',
  },
  'team.notdone': {
    en: '{n} of {total} have not sent {month} in yet: {names}.',
    ml: '{total}-ൽ {n} പേർ {month} ഇതുവരെ അയച്ചിട്ടില്ല: {names}.',
    hi: '{total} में से {n} ने {month} अभी तक नहीं भेजा: {names}।',
    te: '{total}లో {n} మంది {month} ఇంకా పంపలేదు: {names}.',
    ta: '{total} இல் {n} பேர் இன்னும் {month} அனுப்பவில்லை: {names}.',
  },
  'team.alldone': {
    en: 'Everybody has sent {month} in.',
    ml: 'എല്ലാവരും {month} അയച്ചു കഴിഞ്ഞു.',
    hi: 'सभी ने {month} भेज दिया है।',
    te: 'అందరూ {month} పంపారు.',
    ta: 'அனைவரும் {month} அனுப்பிவிட்டார்கள்.',
  },
  'team.weak': {
    en: '{n} below Good {scope}: {names}.',
    ml: '{scope} Good-ന് താഴെ {n} പേർ: {names}.',
    hi: '{scope} Good से नीचे {n} लोग: {names}।',
    te: '{scope} Good కంటే తక్కువ {n} మంది: {names}.',
    ta: '{scope} Good க்குக் கீழே {n} பேர்: {names}.',
  },
  'team.allgood': {
    en: 'Nobody is below Good {scope}.',
    ml: '{scope} ആരും Good-ന് താഴെ അല്ല.',
    hi: '{scope} कोई भी Good से नीचे नहीं है।',
    te: '{scope} ఎవరూ Good కంటే తక్కువ లేరు.',
    ta: '{scope} யாரும் Good க்குக் கீழே இல்லை.',
  },
  'team.person': {
    en: '{name} ({ecode}) {scope}: {score} — {band}.',
    ml: '{name} ({ecode}) {scope}: {score} — {band}.',
    hi: '{name} ({ecode}) {scope}: {score} — {band}।',
    te: '{name} ({ecode}) {scope}: {score} — {band}.',
    ta: '{name} ({ecode}) {scope}: {score} — {band}.',
  },
  'team.person.none': {
    en: '{name} ({ecode}) has no scored month {scope}.',
    ml: '{name} ({ecode}) — {scope} സ്കോർ ചെയ്ത മാസമില്ല.',
    hi: '{name} ({ecode}) का {scope} कोई स्कोर किया महीना नहीं है।',
    te: '{name} ({ecode}) కు {scope} స్కోర్ చేసిన నెల లేదు.',
    ta: '{name} ({ecode}) க்கு {scope} மதிப்பெண் பெற்ற மாதம் இல்லை.',
  },
  'team.overview': {
    en: '{n} people, averaging {avg} {scope}. Highest {best}, lowest {worst}.',
    ml: '{n} പേർ, ശരാശരി {avg} {scope}. ഏറ്റവും ഉയർന്നത് {best}, കുറവ് {worst}.',
    hi: '{n} लोग, औसत {avg} {scope}। सबसे अधिक {best}, सबसे कम {worst}।',
    te: '{n} మంది, సగటు {avg} {scope}. అత్యధికం {best}, అత్యల్పం {worst}.',
    ta: '{n} பேர், {scope} சராசரி {avg}. அதிகபட்சம் {best}, குறைந்தது {worst}.',
  },
  'team.nodata': {
    en: 'Nothing has been scored for your team {scope}.',
    ml: 'നിങ്ങളുടെ ടീമിന് {scope} ഒന്നും സ്കോർ ചെയ്തിട്ടില്ല.',
    hi: 'आपकी टीम के लिए {scope} कुछ भी स्कोर नहीं हुआ है।',
    te: 'మీ టీమ్‌కు {scope} ఏమీ స్కోర్ కాలేదు.',
    ta: '{scope} உங்கள் குழுவுக்கு எதற்கும் மதிப்பெண் அளிக்கப்படவில்லை.',
  },
  'scope.year': { en: 'this year', ml: 'ഈ വർഷം', hi: 'इस वर्ष', te: 'ఈ సంవత్సరం', ta: 'இந்த ஆண்டு' },

  // ---- a manager's queue -----------------------------------------
  'team.clear': {
    en: 'Nothing is waiting on you right now.',
    ml: 'ഇപ്പോൾ നിങ്ങളുടെ അടുത്ത് ഒന്നും കാത്തിരിക്കുന്നില്ല.',
    hi: 'अभी आपके पास कुछ भी लंबित नहीं है।',
    te: 'ప్రస్తుతం మీ వద్ద ఏమీ పెండింగ్‌లో లేదు.',
    ta: 'இப்போது உங்களிடம் எதுவும் காத்திருக்கவில்லை.',
  },
  'team.waiting': {
    en: 'Waiting on you: {parts}.',
    ml: 'നിങ്ങളുടെ അടുത്ത് കാത്തിരിക്കുന്നത്: {parts}.',
    hi: 'आपके पास लंबित: {parts}।',
    te: 'మీ వద్ద పెండింగ్: {parts}.',
    ta: 'உங்களிடம் காத்திருப்பவை: {parts}.',
  },
  'team.approvals': {
    en: '{n} KPI(s) to approve',
    ml: '{n} KPI അംഗീകരിക്കാൻ',
    hi: '{n} KPI स्वीकृत करने हैं',
    te: '{n} KPI ఆమోదించాలి',
    ta: 'ஒப்புதல் அளிக்க {n} KPI',
  },
  'team.scoring': {
    en: '{n} month(s) to score',
    ml: '{n} മാസം സ്കോർ ചെയ്യാൻ',
    hi: '{n} महीने स्कोर करने हैं',
    te: '{n} నెలలు స్కోర్ చేయాలి',
    ta: 'மதிப்பெண் அளிக்க {n} மாதம்',
  },
}
