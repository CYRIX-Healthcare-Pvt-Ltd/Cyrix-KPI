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
  },
  lost: {
    en: 'I do not know that one, {name}. The manual may — or ask your manager.',
    ml: 'അത് എനിക്ക് അറിയില്ല, {name}. മാനുവലിൽ ഉണ്ടാകാം — അല്ലെങ്കിൽ നിങ്ങളുടെ മാനേജറോട് ചോദിക്കുക.',
    hi: 'यह मुझे नहीं पता, {name}। मैनुअल में हो सकता है — या अपने मैनेजर से पूछें।',
    te: 'అది నాకు తెలియదు, {name}. మాన్యువల్‌లో ఉండవచ్చు — లేదా మీ మేనేజర్‌ను అడగండి.',
  },

  manual: {
    en: 'The manual is one short page about your own login — what to do each month, and when.',
    ml: 'മാനുവൽ എന്നത് നിങ്ങളുടെ ലോഗിനെക്കുറിച്ചുള്ള ഒരു ചെറിയ പേജാണ് — ഓരോ മാസവും എന്ത് ചെയ്യണം, എപ്പോൾ ചെയ്യണം.',
    hi: 'मैनुअल आपके अपने लॉगिन के बारे में एक छोटा पृष्ठ है — हर महीने क्या करना है, और कब।',
    te: 'మాన్యువల్ అనేది మీ లాగిన్ గురించిన ఒక చిన్న పేజీ — ప్రతి నెలా ఏమి చేయాలి, ఎప్పుడు చేయాలి.',
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
  },

  // ---- who am I ------------------------------------------------
  whoami: {
    en: 'You are {name}, employee code {ecode}.',
    ml: 'നിങ്ങൾ {name} ആണ്, employee code {ecode}.',
    hi: 'आप {name} हैं, employee code {ecode}।',
    te: 'మీరు {name}, employee code {ecode}.',
  },

  // ---- one month -----------------------------------------------
  'month.scored': {
    en: '{month} came to {score} out of 100 — {band}.',
    ml: '{month} മാസത്തെ സ്കോർ 100-ൽ {score} ആണ് — {band}.',
    hi: '{month} में आपका स्कोर 100 में से {score} रहा — {band}।',
    te: '{month} నెలలో మీ స్కోర్ 100కి {score} — {band}.',
  },
  'month.none': {
    en: '{month} has not been assessed. Nothing was submitted for it.',
    ml: '{month} മാസം വിലയിരുത്തിയിട്ടില്ല. അതിന് ഒന്നും സമർപ്പിച്ചിട്ടില്ല.',
    hi: '{month} का मूल्यांकन नहीं हुआ है। उसके लिए कुछ भी जमा नहीं किया गया।',
    te: '{month} నెల మదింపు జరగలేదు. దాని కోసం ఏమీ సమర్పించలేదు.',
  },
  'month.waiting': {
    en: '{month} is with your manager and has not been scored yet.',
    ml: '{month} മാസം നിങ്ങളുടെ മാനേജറുടെ അടുത്താണ്, ഇതുവരെ സ്കോർ ചെയ്തിട്ടില്ല.',
    hi: '{month} आपके मैनेजर के पास है और अभी तक स्कोर नहीं हुआ है।',
    te: '{month} మీ మేనేజర్ వద్ద ఉంది, ఇంకా స్కోర్ చేయలేదు.',
  },
  'month.draft': {
    en: '{month} is still a draft — it has not been sent in yet.',
    ml: '{month} ഇപ്പോഴും draft ആണ് — ഇതുവരെ അയച്ചിട്ടില്ല.',
    hi: '{month} अभी भी draft है — अभी तक भेजा नहीं गया है।',
    te: '{month} ఇంకా draft లోనే ఉంది — ఇంకా పంపలేదు.',
  },

  // ---- the year ------------------------------------------------
  year: {
    en: 'Your FY {fy} average is {avg} across {n} scored month(s) — {band}.',
    ml: 'FY {fy}-ലെ നിങ്ങളുടെ ശരാശരി {avg} ആണ്, {n} മാസത്തെ സ്കോർ അടിസ്ഥാനമാക്കി — {band}.',
    hi: 'FY {fy} में आपका औसत {avg} है, {n} महीनों के स्कोर पर — {band}।',
    te: 'FY {fy}లో మీ సగటు {avg}, {n} నెలల స్కోర్ ఆధారంగా — {band}.',
  },
  'year.none': {
    en: 'Nothing has been scored yet this year, so there is no average to show.',
    ml: 'ഈ വർഷം ഇതുവരെ ഒന്നും സ്കോർ ചെയ്തിട്ടില്ല, അതിനാൽ ശരാശരി കാണിക്കാനില്ല.',
    hi: 'इस वर्ष अभी तक कुछ भी स्कोर नहीं हुआ है, इसलिए कोई औसत नहीं है।',
    te: 'ఈ సంవత్సరం ఇంకా ఏమీ స్కోర్ కాలేదు, కాబట్టి సగటు చూపడానికి లేదు.',
  },
  split: {
    en: 'On average this year: {parts}.',
    ml: 'ഈ വർഷത്തെ ശരാശരി: {parts}.',
    hi: 'इस वर्ष का औसत: {parts}।',
    te: 'ఈ సంవత్సరం సగటు: {parts}.',
  },
  months: {
    en: '{done} month(s) scored so far.',
    ml: 'ഇതുവരെ {done} മാസം സ്കോർ ചെയ്തു.',
    hi: 'अब तक {done} महीने स्कोर हुए हैं।',
    te: 'ఇప్పటివరకు {done} నెలలు స్కోర్ అయ్యాయి.',
  },
  'months.open': {
    en: '{done} month(s) scored so far, and {open} still with you or your manager.',
    ml: 'ഇതുവരെ {done} മാസം സ്കോർ ചെയ്തു, {open} മാസം ഇപ്പോഴും നിങ്ങളുടെയോ മാനേജറുടെയോ അടുത്താണ്.',
    hi: 'अब तक {done} महीने स्कोर हुए, और {open} अभी भी आपके या आपके मैनेजर के पास हैं।',
    te: 'ఇప్పటివరకు {done} నెలలు స్కోర్ అయ్యాయి, {open} ఇంకా మీ లేదా మీ మేనేజర్ వద్ద ఉన్నాయి.',
  },
  bestworst: {
    en: 'Your best month is {best} ({bestScore}) and your lowest is {worst} ({worstScore}).',
    ml: 'നിങ്ങളുടെ ഏറ്റവും മികച്ച മാസം {best} ({bestScore}), ഏറ്റവും കുറഞ്ഞത് {worst} ({worstScore}).',
    hi: 'आपका सबसे अच्छा महीना {best} ({bestScore}) है और सबसे कम {worst} ({worstScore}) है।',
    te: 'మీ ఉత్తమ నెల {best} ({bestScore}), అత్యల్పం {worst} ({worstScore}).',
  },
  'bestworst.none': {
    en: 'Nothing has been scored yet this year.',
    ml: 'ഈ വർഷം ഇതുവരെ ഒന്നും സ്കോർ ചെയ്തിട്ടില്ല.',
    hi: 'इस वर्ष अभी तक कुछ भी स्कोर नहीं हुआ है।',
    te: 'ఈ సంవత్సరం ఇంకా ఏమీ స్కోర్ కాలేదు.',
  },

  // ---- one row of the KPI, not the block it sits in ---------------
  'kra.weakest': {
    en: 'Your weakest row is {kra} at {pct}% of its {weightage}% — {band}. Strongest is {best} at {bestPct}%.',
    ml: 'ഏറ്റവും ദുർബലമായ വരി {kra} ആണ് — അതിന്റെ {weightage}%-ൽ {pct}%, {band}. ഏറ്റവും മികച്ചത് {best} ({bestPct}%).',
    hi: 'आपकी सबसे कमज़ोर पंक्ति {kra} है — उसके {weightage}% में से {pct}%, {band}। सबसे मज़बूत {best} ({bestPct}%)।',
    te: 'మీ బలహీన వరుస {kra} — దాని {weightage}%లో {pct}%, {band}. బలమైనది {best} ({bestPct}%).',
  },
  'kra.best': {
    en: 'Your strongest row is {kra} at {pct}% of its {weightage}% — {band}.',
    ml: 'ഏറ്റവും മികച്ച വരി {kra} ആണ് — അതിന്റെ {weightage}%-ൽ {pct}%, {band}.',
    hi: 'आपकी सबसे मज़बूत पंक्ति {kra} है — उसके {weightage}% में से {pct}%, {band}।',
    te: 'మీ బలమైన వరుస {kra} — దాని {weightage}%లో {pct}%, {band}.',
  },
  'kra.declining': {
    en: '{kra} is falling — {from}% earlier in the year, {to}% lately.',
    ml: '{kra} കുറയുന്നു — വർഷത്തിന്റെ തുടക്കത്തിൽ {from}%, അടുത്തിടെ {to}%.',
    hi: '{kra} गिर रहा है — वर्ष की शुरुआत में {from}%, हाल में {to}%।',
    te: '{kra} తగ్గుతోంది — సంవత్సర ఆరంభంలో {from}%, ఇటీవల {to}%.',
  },
  'kra.steady': {
    en: 'Nothing is falling. The lowest is {kra} at {pct}%, and it is not dropping.',
    ml: 'ഒന്നും കുറയുന്നില്ല. ഏറ്റവും കുറവ് {kra} ({pct}%), അത് കുറയുന്നുമില്ല.',
    hi: 'कुछ भी नहीं गिर रहा। सबसे कम {kra} ({pct}%) है, और वह गिर नहीं रहा।',
    te: 'ఏదీ తగ్గడం లేదు. అత్యల్పం {kra} ({pct}%), అది తగ్గడం లేదు.',
  },
  'kra.none': {
    en: 'No month has been scored yet, so there is nothing to compare.',
    ml: 'ഇതുവരെ ഒരു മാസവും സ്കോർ ചെയ്തിട്ടില്ല, താരതമ്യം ചെയ്യാൻ ഒന്നുമില്ല.',
    hi: 'अभी तक कोई महीना स्कोर नहीं हुआ, तुलना करने के लिए कुछ नहीं है।',
    te: 'ఇంకా ఏ నెలా స్కోర్ కాలేదు, పోల్చడానికి ఏమీ లేదు.',
  },
  'core.weakest': {
    en: 'Your lowest core value is {name}, averaging {pct} out of 100.',
    ml: 'ഏറ്റവും കുറഞ്ഞ core value {name} ആണ്, ശരാശരി 100-ൽ {pct}.',
    hi: 'आपका सबसे कम core value {name} है, औसत 100 में से {pct}।',
    te: 'మీ అత్యల్ప core value {name}, సగటు 100కి {pct}.',
  },
  'core.declining': {
    en: '{name} is slipping — {from} earlier in the year, {to} lately.',
    ml: '{name} കുറയുന്നു — വർഷത്തിന്റെ തുടക്കത്തിൽ {from}, അടുത്തിടെ {to}.',
    hi: '{name} गिर रहा है — वर्ष की शुरुआत में {from}, हाल में {to}।',
    te: '{name} తగ్గుతోంది — సంవత్సర ఆరంభంలో {from}, ఇటీవల {to}.',
  },
  'core.steady': {
    en: 'No core value is slipping. The lowest is {name} at {pct} out of 100.',
    ml: 'ഒരു core value-ഉം കുറയുന്നില്ല. ഏറ്റവും കുറവ് {name} (100-ൽ {pct}).',
    hi: 'कोई core value नहीं गिर रहा। सबसे कम {name} (100 में से {pct}) है।',
    te: 'ఏ core value తగ్గడం లేదు. అత్యల్పం {name} (100కి {pct}).',
  },
  'core.none': {
    en: 'No core value ratings yet this year.',
    ml: 'ഈ വർഷം ഇതുവരെ core value റേറ്റിംഗുകൾ ഇല്ല.',
    hi: 'इस वर्ष अभी तक कोई core value रेटिंग नहीं है।',
    te: 'ఈ సంవత్సరం ఇంకా core value రేటింగ్‌లు లేవు.',
  },

  // ---- the KPI itself -------------------------------------------
  'kpi.active': {
    en: 'Your KPI is approved and in force for the year.',
    ml: 'നിങ്ങളുടെ KPI അംഗീകരിച്ചു, ഈ വർഷത്തേക്ക് പ്രാബല്യത്തിലാണ്.',
    hi: 'आपका KPI स्वीकृत है और इस वर्ष के लिए लागू है।',
    te: 'మీ KPI ఆమోదించబడింది, ఈ సంవత్సరానికి అమలులో ఉంది.',
  },
  'kpi.pending': {
    en: 'Your KPI is with your manager, waiting to be approved.',
    ml: 'നിങ്ങളുടെ KPI മാനേജറുടെ അടുത്താണ്, അംഗീകാരത്തിനായി കാത്തിരിക്കുന്നു.',
    hi: 'आपका KPI आपके मैनेजर के पास है, स्वीकृति की प्रतीक्षा में।',
    te: 'మీ KPI మీ మేనేజర్ వద్ద ఉంది, ఆమోదం కోసం వేచి ఉంది.',
  },
  'kpi.rejected': {
    en: 'Your manager sent your KPI back. Open My KPI to see why, change it and send it again.',
    ml: 'നിങ്ങളുടെ മാനേജർ KPI തിരികെ അയച്ചു. കാരണം കാണാൻ My KPI തുറക്കുക, മാറ്റി വീണ്ടും അയക്കുക.',
    hi: 'आपके मैनेजर ने आपका KPI वापस भेजा है। कारण देखने के लिए My KPI खोलें, बदलें और फिर से भेजें।',
    te: 'మీ మేనేజర్ మీ KPIని వెనక్కి పంపారు. కారణం చూడటానికి My KPI తెరవండి, మార్చి మళ్లీ పంపండి.',
  },
  'kpi.draft': {
    en: 'Your KPI is still a draft. Finish it and send it to your manager.',
    ml: 'നിങ്ങളുടെ KPI ഇപ്പോഴും draft ആണ്. പൂർത്തിയാക്കി മാനേജർക്ക് അയക്കുക.',
    hi: 'आपका KPI अभी भी draft है। इसे पूरा करके अपने मैनेजर को भेजें।',
    te: 'మీ KPI ఇంకా draft లోనే ఉంది. పూర్తి చేసి మీ మేనేజర్‌కు పంపండి.',
  },
  'kpi.none': {
    en: 'You have not set up a KPI for this year yet.',
    ml: 'ഈ വർഷത്തേക്ക് നിങ്ങൾ ഇതുവരെ KPI സെറ്റ് ചെയ്തിട്ടില്ല.',
    hi: 'आपने इस वर्ष के लिए अभी तक KPI सेट नहीं किया है।',
    te: 'ఈ సంవత్సరానికి మీరు ఇంకా KPI సెట్ చేయలేదు.',
  },

  // ---- a manager's team ------------------------------------------
  'team.size': {
    en: '{n} people report to you.',
    ml: '{n} പേർ നിങ്ങൾക്ക് കീഴിൽ റിപ്പോർട്ട് ചെയ്യുന്നു.',
    hi: '{n} लोग आपको रिपोर्ट करते हैं।',
    te: '{n} మంది మీకు రిపోర్ట్ చేస్తారు.',
  },
  'team.average': {
    en: 'Your team averaged {avg} {scope}, across {n} people — {band}.',
    ml: 'നിങ്ങളുടെ ടീമിന്റെ ശരാശരി {scope} {avg} ആണ്, {n} പേരുടെ അടിസ്ഥാനത്തിൽ — {band}.',
    hi: 'आपकी टीम का औसत {scope} {avg} है, {n} लोगों पर — {band}।',
    te: 'మీ టీమ్ సగటు {scope} {avg}, {n} మంది ఆధారంగా — {band}.',
  },
  'team.lowest': {
    en: 'Lowest {scope}: {name} ({ecode}) at {score} — {band}.',
    ml: 'ഏറ്റവും കുറവ് {scope}: {name} ({ecode}) — {score}, {band}.',
    hi: 'सबसे कम {scope}: {name} ({ecode}) — {score}, {band}।',
    te: 'అత్యల్పం {scope}: {name} ({ecode}) — {score}, {band}.',
  },
  'team.highest': {
    en: 'Highest {scope}: {name} ({ecode}) at {score} — {band}.',
    ml: 'ഏറ്റവും ഉയർന്നത് {scope}: {name} ({ecode}) — {score}, {band}.',
    hi: 'सबसे अधिक {scope}: {name} ({ecode}) — {score}, {band}।',
    te: 'అత్యధికం {scope}: {name} ({ecode}) — {score}, {band}.',
  },
  'team.notdone': {
    en: '{n} of {total} have not sent {month} in yet: {names}.',
    ml: '{total}-ൽ {n} പേർ {month} ഇതുവരെ അയച്ചിട്ടില്ല: {names}.',
    hi: '{total} में से {n} ने {month} अभी तक नहीं भेजा: {names}।',
    te: '{total}లో {n} మంది {month} ఇంకా పంపలేదు: {names}.',
  },
  'team.alldone': {
    en: 'Everybody has sent {month} in.',
    ml: 'എല്ലാവരും {month} അയച്ചു കഴിഞ്ഞു.',
    hi: 'सभी ने {month} भेज दिया है।',
    te: 'అందరూ {month} పంపారు.',
  },
  'team.weak': {
    en: '{n} below Good {scope}: {names}.',
    ml: '{scope} Good-ന് താഴെ {n} പേർ: {names}.',
    hi: '{scope} Good से नीचे {n} लोग: {names}।',
    te: '{scope} Good కంటే తక్కువ {n} మంది: {names}.',
  },
  'team.allgood': {
    en: 'Nobody is below Good {scope}.',
    ml: '{scope} ആരും Good-ന് താഴെ അല്ല.',
    hi: '{scope} कोई भी Good से नीचे नहीं है।',
    te: '{scope} ఎవరూ Good కంటే తక్కువ లేరు.',
  },
  'team.person': {
    en: '{name} ({ecode}) {scope}: {score} — {band}.',
    ml: '{name} ({ecode}) {scope}: {score} — {band}.',
    hi: '{name} ({ecode}) {scope}: {score} — {band}।',
    te: '{name} ({ecode}) {scope}: {score} — {band}.',
  },
  'team.person.none': {
    en: '{name} ({ecode}) has no scored month {scope}.',
    ml: '{name} ({ecode}) — {scope} സ്കോർ ചെയ്ത മാസമില്ല.',
    hi: '{name} ({ecode}) का {scope} कोई स्कोर किया महीना नहीं है।',
    te: '{name} ({ecode}) కు {scope} స్కోర్ చేసిన నెల లేదు.',
  },
  'team.overview': {
    en: '{n} people, averaging {avg} {scope}. Highest {best}, lowest {worst}.',
    ml: '{n} പേർ, ശരാശരി {avg} {scope}. ഏറ്റവും ഉയർന്നത് {best}, കുറവ് {worst}.',
    hi: '{n} लोग, औसत {avg} {scope}। सबसे अधिक {best}, सबसे कम {worst}।',
    te: '{n} మంది, సగటు {avg} {scope}. అత్యధికం {best}, అత్యల్పం {worst}.',
  },
  'team.nodata': {
    en: 'Nothing has been scored for your team {scope}.',
    ml: 'നിങ്ങളുടെ ടീമിന് {scope} ഒന്നും സ്കോർ ചെയ്തിട്ടില്ല.',
    hi: 'आपकी टीम के लिए {scope} कुछ भी स्कोर नहीं हुआ है।',
    te: 'మీ టీమ్‌కు {scope} ఏమీ స్కోర్ కాలేదు.',
  },
  'scope.year': { en: 'this year', ml: 'ഈ വർഷം', hi: 'इस वर्ष', te: 'ఈ సంవత్సరం' },

  // ---- a manager's queue -----------------------------------------
  'team.clear': {
    en: 'Nothing is waiting on you right now.',
    ml: 'ഇപ്പോൾ നിങ്ങളുടെ അടുത്ത് ഒന്നും കാത്തിരിക്കുന്നില്ല.',
    hi: 'अभी आपके पास कुछ भी लंबित नहीं है।',
    te: 'ప్రస్తుతం మీ వద్ద ఏమీ పెండింగ్‌లో లేదు.',
  },
  'team.waiting': {
    en: 'Waiting on you: {parts}.',
    ml: 'നിങ്ങളുടെ അടുത്ത് കാത്തിരിക്കുന്നത്: {parts}.',
    hi: 'आपके पास लंबित: {parts}।',
    te: 'మీ వద్ద పెండింగ్: {parts}.',
  },
  'team.approvals': {
    en: '{n} KPI(s) to approve',
    ml: '{n} KPI അംഗീകരിക്കാൻ',
    hi: '{n} KPI स्वीकृत करने हैं',
    te: '{n} KPI ఆమోదించాలి',
  },
  'team.scoring': {
    en: '{n} month(s) to score',
    ml: '{n} മാസം സ്കോർ ചെയ്യാൻ',
    hi: '{n} महीने स्कोर करने हैं',
    te: '{n} నెలలు స్కోర్ చేయాలి',
  },
}
