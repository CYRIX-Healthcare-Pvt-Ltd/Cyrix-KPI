import type { Phrase } from './i18n'

/**
 * Every word on the manual page, in one place.
 *
 * The four languages sit together per key rather than in separate files
 * so that a reviewer can read the English and its translation on
 * adjacent lines. That is the only way anybody is going to catch a
 * sentence that has drifted.
 *
 * The Malayalam is deliberately literal and short. This page states
 * rules that decide somebody's appraisal — how long they have to submit,
 * when a score can still be queried — and a fluent paraphrase is exactly
 * how a rule quietly changes meaning. Where a choice existed between
 * natural phrasing and staying close to the English, it stays close.
 *
 * Anything the software prints stays in English inside the sentence, so
 * a reader can find it on screen afterwards. See KEEP_ENGLISH.
 *
 * {tmDays}, {mgrDays} and {closingDay} are filled from live settings.
 */
export const HELP: Record<string, Phrase> = {
  // ---- the page itself -----------------------------------------
  'page.back': {
    en: 'Back to my profile',
    ml: 'എന്റെ പ്രൊഫൈലിലേക്ക് മടങ്ങുക',
  },
  'page.title': {
    en: 'What I can do',
    ml: 'എനിക്ക് എന്തൊക്കെ ചെയ്യാം',
  },
  'page.scopeStrong': {
    en: 'your',
    ml: 'നിങ്ങളുടെ',
  },
  'page.scopeBefore': {
    en: 'This page only lists what',
    ml: 'ഈ പേജിൽ പറയുന്നത്',
  },
  'page.scopeAfter': {
    en: 'login can do. If a colleague can see something you cannot, it is because their job is different, not because something is broken.',
    ml: 'ലോഗിന് ചെയ്യാൻ കഴിയുന്ന കാര്യങ്ങൾ മാത്രമാണ്. നിങ്ങൾക്ക് കാണാൻ കഴിയാത്ത ഒന്ന് ഒരു സഹപ്രവർത്തകന് കാണാൻ കഴിയുന്നുണ്ടെങ്കിൽ, അത് അവരുടെ ജോലി വ്യത്യസ്തമായതുകൊണ്ടാണ്, എന്തെങ്കിലും തകരാറായതുകൊണ്ടല്ല.',
  },
  'page.readIn': {
    en: 'Read this in',
    ml: 'ഇത് വായിക്കേണ്ട ഭാഷ',
  },

  // ---- 1. your KPI ---------------------------------------------
  's1.title': {
    en: '1. Your KPI for the year',
    ml: '1. ഈ വർഷത്തെ നിങ്ങളുടെ KPI',
  },
  's1.lead': {
    en: 'This is the list of things you are measured on. It is agreed once a year.',
    ml: 'നിങ്ങളെ വിലയിരുത്തുന്ന കാര്യങ്ങളുടെ പട്ടികയാണിത്. വർഷത്തിൽ ഒരിക്കൽ ഇത് അംഗീകരിക്കുന്നു.',
  },
  's1.p1.what': {
    en: 'Write your KPI',
    ml: 'നിങ്ങളുടെ KPI എഴുതുക',
  },
  's1.p1.how': {
    en: 'List your job role targets. Job Role is 80 marks. Core Values is the other 20. If you also have ESMS, Core Values becomes 15 and ESMS is 5.',
    ml: 'നിങ്ങളുടെ Job Role ടാർഗറ്റുകൾ എഴുതുക. Job Role-ന് 80 മാർക്ക്. ബാക്കി 20 Core Values-ന്. നിങ്ങൾക്ക് ESMS കൂടി ഉണ്ടെങ്കിൽ Core Values 15 ആകും, ESMS 5 ആകും.',
  },
  's1.p2.what': {
    en: 'If a row measures something different some months',
    ml: 'ചില മാസങ്ങളിൽ ഒരു വരി മറ്റൊന്ന് അളക്കുന്നുവെങ്കിൽ',
  },
  's1.p2.how': {
    en: 'Use Add an alternative on that row. Same weightage, different KRA and target. Each month you pick which one applied.',
    ml: 'ആ വരിയിൽ Add an alternative ഉപയോഗിക്കുക. അതേ weightage, വ്യത്യസ്ത KRA-യും ടാർഗറ്റും. ഏതാണ് ബാധകമായത് എന്ന് ഓരോ മാസവും നിങ്ങൾ തിരഞ്ഞെടുക്കുന്നു.',
  },
  's1.p3.what': {
    en: 'Say which month it starts from',
    ml: 'ഏത് മാസം മുതൽ തുടങ്ങുന്നു എന്ന് പറയുക',
  },
  's1.p3.how': {
    en: 'April if you were here all year. If you joined later, pick the month you joined. The months before it are not asked for and do not count as missing.',
    ml: 'വർഷം മുഴുവൻ ഇവിടെ ഉണ്ടായിരുന്നെങ്കിൽ ഏപ്രിൽ. പിന്നീട് ചേർന്നതാണെങ്കിൽ, ചേർന്ന മാസം തിരഞ്ഞെടുക്കുക. അതിനു മുമ്പുള്ള മാസങ്ങൾ നിങ്ങളോട് ചോദിക്കില്ല, അവ വിട്ടുപോയതായി കണക്കാക്കുകയുമില്ല.',
  },
  's1.p4.what': {
    en: 'Send it to your manager',
    ml: 'നിങ്ങളുടെ മാനേജർക്ക് അയയ്ക്കുക',
  },
  's1.p4.how': {
    en: 'Your manager has to approve it. You cannot start any month until they do.',
    ml: 'നിങ്ങളുടെ മാനേജർ ഇത് അംഗീകരിക്കണം. അതുവരെ ഒരു മാസവും തുടങ്ങാൻ കഴിയില്ല.',
  },
  's1.p5.what': {
    en: 'If it comes back',
    ml: 'തിരികെ വന്നാൽ',
  },
  's1.p5.how': {
    en: 'Your manager may send it back with a reason. Change it and send it again.',
    ml: 'നിങ്ങളുടെ മാനേജർ ഒരു കാരണം എഴുതി ഇത് തിരികെ അയച്ചേക്കാം. മാറ്റം വരുത്തി വീണ്ടും അയയ്ക്കുക.',
  },

  // ---- 2. every month ------------------------------------------
  's2.title': {
    en: '2. Every month',
    ml: '2. എല്ലാ മാസവും',
  },
  's2.lead': {
    en: 'You do this once a month, for the month that has just finished.',
    ml: 'ഇപ്പോൾ കഴിഞ്ഞ മാസത്തേക്ക്, മാസത്തിൽ ഒരിക്കൽ ഇത് ചെയ്യുക.',
  },
  's2.p1.what': {
    en: 'Enter what you achieved',
    ml: 'നിങ്ങൾ നേടിയത് എഴുതുക',
  },
  's2.p1.how': {
    en: 'Put the real number against each target. The app works out the score for you.',
    ml: 'ഓരോ ടാർഗറ്റിനും നേരെ യഥാർഥ സംഖ്യ എഴുതുക. സ്കോർ ആപ്പ് കണക്കാക്കും.',
  },
  's2.p2.what': {
    en: 'Rate yourself on the Core Values',
    ml: 'Core Values-ൽ സ്വയം റേറ്റിംഗ് നൽകുക',
  },
  's2.p2.how': {
    en: 'Five values. Pick a rating for each one.',
    ml: 'അഞ്ച് മൂല്യങ്ങൾ. ഓരോന്നിനും ഒരു റേറ്റിംഗ് തിരഞ്ഞെടുക്കുക.',
  },
  's2.p3.what': {
    en: 'Send it to your manager',
    ml: 'നിങ്ങളുടെ മാനേജർക്ക് അയയ്ക്കുക',
  },
  's2.p3.how': {
    en: 'Try to send it within {tmDays} days of the month ending. After that it counts as late.',
    ml: 'മാസം അവസാനിച്ച് {tmDays} ദിവസത്തിനുള്ളിൽ അയയ്ക്കാൻ ശ്രമിക്കുക. അതിനുശേഷം ഇത് വൈകിയതായി കണക്കാക്കും.',
  },
  's2.p4.what': {
    en: 'Your manager reviews it',
    ml: 'നിങ്ങളുടെ മാനേജർ ഇത് പരിശോധിക്കുന്നു',
  },
  's2.p4.how': {
    en: 'They enter their own figure for each row. Your final score is the average of yours and theirs. They have {mgrDays} days. The status then reads Manager reviewed.',
    ml: 'ഓരോ വരിക്കും അവർ അവരുടെ സ്വന്തം സംഖ്യ എഴുതുന്നു. നിങ്ങളുടെ അന്തിമ സ്കോർ നിങ്ങളുടെയും അവരുടെയും ശരാശരിയാണ്. അവർക്ക് {mgrDays} ദിവസമുണ്ട്. പിന്നീട് സ്റ്റാറ്റസ് Manager reviewed എന്ന് കാണിക്കും.',
  },
  's2.p5.what': {
    en: 'If their score is a lot lower than yours',
    ml: 'അവരുടെ സ്കോർ നിങ്ങളുടേതിനെക്കാൾ വളരെ കുറവാണെങ്കിൽ',
  },
  's2.p5.how': {
    en: 'More than 5 points below what you gave yourself and they have to write why before they can submit. You see that reason on the month, next to the score.',
    ml: 'നിങ്ങൾ സ്വയം നൽകിയതിനെക്കാൾ 5 പോയിന്റിൽ കൂടുതൽ കുറവാണെങ്കിൽ, സമർപ്പിക്കുന്നതിന് മുമ്പ് കാരണം എഴുതണം. ആ കാരണം സ്കോറിനു അടുത്തായി ആ മാസത്തിൽ നിങ്ങൾക്ക് കാണാം.',
  },
  's2.p6.what.open': {
    en: 'Your manager closes the month',
    ml: 'നിങ്ങളുടെ മാനേജർ മാസം അവസാനിപ്പിക്കുന്നു',
  },
  's2.p6.how.open': {
    en: 'There is no closing date at the moment, so your manager marks each month Final when they are ready. Until they do, you can still query the scores.',
    ml: 'ഇപ്പോൾ ഒരു ക്ലോസിംഗ് തീയതി ഇല്ല, അതിനാൽ തയ്യാറാകുമ്പോൾ നിങ്ങളുടെ മാനേജർ ഓരോ മാസവും Final ആയി അടയാളപ്പെടുത്തും. അതുവരെ നിങ്ങൾക്ക് സ്കോറുകളെക്കുറിച്ച് ചോദ്യം ഉന്നയിക്കാം.',
  },
  's2.p6.what.day': {
    en: 'The month closes on its own',
    ml: 'മാസം സ്വയം അവസാനിക്കുന്നു',
  },
  's2.p6.how.day': {
    en: 'Every month closes on the {closingDay} of the month after it. Nobody presses a button. Until that day you can query the scores; after it the status becomes Final.',
    ml: 'ഓരോ മാസവും അതിനടുത്ത മാസത്തെ {closingDay}-ാം തീയതി അവസാനിക്കും. ആരും ഒരു ബട്ടണും അമർത്തേണ്ടതില്ല. ആ ദിവസം വരെ നിങ്ങൾക്ക് സ്കോറുകളെക്കുറിച്ച് ചോദ്യം ഉന്നയിക്കാം; അതിനുശേഷം സ്റ്റാറ്റസ് Final ആകും.',
  },

  // ---- 3. disagreeing with a score -----------------------------
  's3.title': {
    en: '3. If you do not agree with a score',
    ml: '3. ഒരു സ്കോറിനോട് നിങ്ങൾ യോജിക്കുന്നില്ലെങ്കിൽ',
  },
  's3.lead': {
    en: 'You do not have to just accept it. Ask.',
    ml: 'അത് അതേപടി സ്വീകരിക്കേണ്ട ആവശ്യമില്ല. ചോദിക്കുക.',
  },
  's3.p1.what': {
    en: 'Raise a query',
    ml: 'ഒരു ചോദ്യം ഉന്നയിക്കുക',
  },
  's3.p1.how.base': {
    en: 'Open the month your manager has reviewed. Tick the rows you want looked at. Say for each one whether you want it explained, or you think it is wrong.',
    ml: 'നിങ്ങളുടെ മാനേജർ പരിശോധിച്ച മാസം തുറക്കുക. പരിശോധിക്കേണ്ട വരികൾ ടിക്ക് ചെയ്യുക. ഓരോന്നിനും, വിശദീകരണം വേണോ അതോ അത് തെറ്റാണെന്ന് കരുതുന്നോ എന്ന് പറയുക.',
  },
  's3.p1.how.open': {
    en: 'You can do this for as long as the month is open.',
    ml: 'മാസം തുറന്നിരിക്കുന്നിടത്തോളം കാലം നിങ്ങൾക്ക് ഇത് ചെയ്യാം.',
  },
  's3.p1.how.day': {
    en: 'You have until the {closingDay} of the following month.',
    ml: 'അടുത്ത മാസത്തെ {closingDay}-ാം തീയതി വരെ നിങ്ങൾക്ക് സമയമുണ്ട്.',
  },
  's3.p2.what': {
    en: 'Asking about one core value',
    ml: 'ഒരൊറ്റ core value-യെക്കുറിച്ച് ചോദിക്കുമ്പോൾ',
  },
  's3.p2.how': {
    en: 'Core Values are one score covering five things. Tick that row, then tick the ones you actually mean — Trust, Care, and so on — so your manager knows what to answer.',
    ml: 'Core Values എന്നത് അഞ്ച് കാര്യങ്ങൾ ഉൾപ്പെടുന്ന ഒറ്റ സ്കോറാണ്. ആ വരി ടിക്ക് ചെയ്യുക, തുടർന്ന് നിങ്ങൾ ഉദ്ദേശിക്കുന്നവ ടിക്ക് ചെയ്യുക — Trust, Care എന്നിങ്ങനെ — അപ്പോൾ എന്തിന് മറുപടി നൽകണമെന്ന് മാനേജർക്ക് അറിയാം.',
  },
  's3.p3.what': {
    en: 'Where to see it',
    ml: 'ഇത് എവിടെ കാണാം',
  },
  's3.p3.how': {
    en: 'The month shows Under review on your Assessments list until your manager replies. Open the month to read their answer and whether the score changed.',
    ml: 'മാനേജർ മറുപടി നൽകുന്നതുവരെ നിങ്ങളുടെ Assessments പട്ടികയിൽ ആ മാസം Under review എന്ന് കാണിക്കും. അവരുടെ മറുപടിയും സ്കോർ മാറിയോ എന്നും വായിക്കാൻ ആ മാസം തുറക്കുക.',
  },
  's3.p4.what': {
    en: 'Attach proof if you have it',
    ml: 'തെളിവ് ഉണ്ടെങ്കിൽ ചേർക്കുക',
  },
  's3.p4.how': {
    en: 'A photo, a PDF or a sheet. Optional. It is deleted once the query is finished.',
    ml: 'ഒരു ഫോട്ടോ, PDF അല്ലെങ്കിൽ ഷീറ്റ്. നിർബന്ധമല്ല. ചോദ്യം പൂർത്തിയായാൽ ഇത് ഇല്ലാതാക്കും.',
  },
  's3.p5.what': {
    en: 'What happens next',
    ml: 'അടുത്തതായി എന്ത് സംഭവിക്കും',
  },
  's3.p5.how': {
    en: 'Your manager is told straight away. The month cannot be closed until they reply. You will see their answer, and whether the score was changed.',
    ml: 'നിങ്ങളുടെ മാനേജറെ ഉടൻ അറിയിക്കും. അവർ മറുപടി നൽകുന്നതുവരെ ആ മാസം അവസാനിപ്പിക്കാൻ കഴിയില്ല. അവരുടെ മറുപടിയും സ്കോർ മാറ്റിയോ എന്നും നിങ്ങൾക്ക് കാണാം.',
  },

  // ---- because you have a team ---------------------------------
  'team.title.num': {
    en: '4. Because you have a team',
    ml: '4. നിങ്ങൾക്ക് ഒരു ടീം ഉള്ളതുകൊണ്ട്',
  },
  'team.title.plain': {
    en: 'Your team',
    ml: 'നിങ്ങളുടെ ടീം',
  },
  'team.lead': {
    en: 'Everything above is still yours to do. These are extra.',
    ml: 'മുകളിൽ പറഞ്ഞതെല്ലാം നിങ്ങൾ ചെയ്യേണ്ടതാണ്. ഇവ അതിനു പുറമേയാണ്.',
  },
  'team.p1.what': {
    en: 'Approve their KPI',
    ml: 'അവരുടെ KPI അംഗീകരിക്കുക',
  },
  'team.p1.how': {
    en: 'Nobody on your team can start a month until you approve their KPI for the year. Use Edit to correct a KRA, a weightage, a target or how a row is scored before you approve — it saves as you go, so a typo does not cost a round trip.',
    ml: 'ഈ വർഷത്തെ KPI നിങ്ങൾ അംഗീകരിക്കുന്നതുവരെ നിങ്ങളുടെ ടീമിലെ ആർക്കും ഒരു മാസവും തുടങ്ങാൻ കഴിയില്ല. അംഗീകരിക്കുന്നതിന് മുമ്പ് ഒരു KRA, weightage, ടാർഗറ്റ് അല്ലെങ്കിൽ ഒരു വരി എങ്ങനെ സ്കോർ ചെയ്യുന്നു എന്നത് തിരുത്താൻ Edit ഉപയോഗിക്കുക — ചെയ്യുന്നതിനൊപ്പം സേവ് ആകും, അതിനാൽ ഒരു ചെറിയ തെറ്റിന് വീണ്ടും അയയ്ക്കേണ്ടി വരില്ല.',
  },
  'team.p2.what': {
    en: 'Set the month their KPI starts from',
    ml: 'അവരുടെ KPI ഏത് മാസം മുതൽ തുടങ്ങുന്നു എന്ന് സെറ്റ് ചെയ്യുക',
  },
  'team.p2.how': {
    en: 'On the approval screen. Somebody who joined in June is not asked for April or May, and does not show as missing them. You can fix it later too, as long as they have not already been scored on an earlier month.',
    ml: 'അംഗീകാര സ്ക്രീനിൽ. ജൂണിൽ ചേർന്ന ഒരാളോട് ഏപ്രിലോ മെയ്യോ ചോദിക്കില്ല, അവ വിട്ടുപോയതായി കാണിക്കുകയുമില്ല. പിന്നീടും ഇത് ശരിയാക്കാം, മുൻപത്തെ ഒരു മാസത്തിൽ അവർക്ക് സ്കോർ നൽകിയിട്ടില്ലെങ്കിൽ.',
  },
  'team.p3.what': {
    en: 'Score their months',
    ml: 'അവരുടെ മാസങ്ങൾക്ക് സ്കോർ നൽകുക',
  },
  'team.p3.how': {
    en: 'Enter your own figure against each row. You can also correct the target, because you are the one who knows the right number. Changing a target changes both scores.',
    ml: 'ഓരോ വരിക്കും നേരെ നിങ്ങളുടെ സ്വന്തം സംഖ്യ എഴുതുക. ടാർഗറ്റും തിരുത്താം, കാരണം ശരിയായ സംഖ്യ അറിയുന്നത് നിങ്ങളാണ്. ടാർഗറ്റ് മാറ്റിയാൽ രണ്ട് സ്കോറുകളും മാറും.',
  },
  'team.p4.what': {
    en: 'Say why if you score much lower',
    ml: 'വളരെ കുറഞ്ഞ സ്കോർ നൽകുന്നെങ്കിൽ കാരണം പറയുക',
  },
  'team.p4.how': {
    en: 'If your total is more than 5 points below what they gave themselves, the app asks for a reason and will not let you submit without one. They see it with their score. It saves a query later.',
    ml: 'അവർ സ്വയം നൽകിയതിനെക്കാൾ 5 പോയിന്റിൽ കൂടുതൽ കുറവാണ് നിങ്ങളുടെ ആകെ സ്കോർ എങ്കിൽ, ആപ്പ് ഒരു കാരണം ചോദിക്കും, അത് ഇല്ലാതെ സമർപ്പിക്കാൻ അനുവദിക്കില്ല. അവരുടെ സ്കോറിനൊപ്പം അവർ അത് കാണും. ഇത് പിന്നീടുള്ള ഒരു ചോദ്യം ഒഴിവാക്കും.',
  },
  'team.p5.what': {
    en: 'Answer their queries',
    ml: 'അവരുടെ ചോദ്യങ്ങൾക്ക് മറുപടി നൽകുക',
  },
  'team.p5.how': {
    en: 'If someone questions a score, you get a tab and a badge. Reply, and change the score first if it needs changing. The month stays open until you do.',
    ml: 'ആരെങ്കിലും ഒരു സ്കോറിനെക്കുറിച്ച് ചോദിച്ചാൽ, നിങ്ങൾക്ക് ഒരു ടാബും ബാഡ്ജും ലഭിക്കും. മറുപടി നൽകുക, മാറ്റം വേണമെങ്കിൽ ആദ്യം സ്കോർ മാറ്റുക. നിങ്ങൾ അത് ചെയ്യുന്നതുവരെ ആ മാസം തുറന്നിരിക്കും.',
  },
  'team.p6.what': {
    en: 'Look somebody up quickly',
    ml: 'ഒരാളെക്കുറിച്ച് പെട്ടെന്ന് നോക്കുക',
  },
  'team.p6.how': {
    en: 'Tap a name or a face on My Team for a quick look — who they are, this month, and how each part scored — without leaving the list.',
    ml: 'My Team-ൽ ഒരു പേരിലോ ഫോട്ടോയിലോ ടാപ്പ് ചെയ്താൽ പെട്ടെന്നൊരു കാഴ്ച കിട്ടും — അവർ ആരാണ്, ഈ മാസം, ഓരോ ഭാഗത്തിനും എത്ര സ്കോർ — പട്ടികയിൽ നിന്ന് പുറത്തുപോകാതെ തന്നെ.',
  },
  'team.p7.what': {
    en: 'Remove an unsuitable photo',
    ml: 'അനുയോജ്യമല്ലാത്ത ഫോട്ടോ നീക്കം ചെയ്യുക',
  },
  'team.p7.how': {
    en: 'If somebody uses a picture that is not a clear photo of their face, take it down from the quick look. You have to give a reason, and they are shown it so they can put up another.',
    ml: 'ഒരാൾ അവരുടെ മുഖം വ്യക്തമായി കാണാത്ത ഒരു ചിത്രം ഉപയോഗിക്കുന്നുവെങ്കിൽ, പെട്ടെന്നുള്ള കാഴ്ചയിൽ നിന്ന് അത് നീക്കം ചെയ്യുക. നിങ്ങൾ ഒരു കാരണം നൽകണം, അത് അവർക്ക് കാണിക്കും, അതിനാൽ അവർക്ക് മറ്റൊന്ന് ഇടാം.',
  },
  'team.p8.what': {
    en: 'See how the team is doing',
    ml: 'ടീം എങ്ങനെ പോകുന്നു എന്ന് കാണുക',
  },
  'team.p8.how': {
    en: 'Team analysis shows everybody ranked, with Job Role and Core Values separately. You can pick one month or the whole year, and download it.',
    ml: 'Team analysis എല്ലാവരെയും റാങ്ക് അനുസരിച്ച് കാണിക്കുന്നു, Job Role-ഉം Core Values-ഉം വെവ്വേറെ. ഒരു മാസമോ വർഷം മുഴുവനുമോ തിരഞ്ഞെടുക്കാം, ഡൗൺലോഡും ചെയ്യാം.',
  },
  'team.p9.what': {
    en: 'See what the team total is made of',
    ml: 'ടീമിന്റെ ആകെ സ്കോർ എന്തുകൊണ്ടുണ്ടായി എന്ന് കാണുക',
  },
  'team.p9.how': {
    en: 'My Team and Team analysis both show the team average split into Job Role, Core Values and ESMS. Each is a percentage of its own weightage, so they can be compared — 14 out of 15 is better than 16 out of 20.',
    ml: 'My Team-ഉം Team analysis-ഉം ടീമിന്റെ ശരാശരി Job Role, Core Values, ESMS എന്നിങ്ങനെ വേർതിരിച്ച് കാണിക്കുന്നു. ഓരോന്നും അതിന്റെ സ്വന്തം weightage-ന്റെ ശതമാനമാണ്, അതിനാൽ അവ താരതമ്യം ചെയ്യാം — 15-ൽ 14 എന്നത് 20-ൽ 16-നെക്കാൾ മികച്ചതാണ്.',
  },
  'team.p10.what': {
    en: 'See whether the team is bunched or spread',
    ml: 'ടീം ഒരുമിച്ചാണോ ചിതറിയാണോ എന്ന് കാണുക',
  },
  'team.p10.how': {
    en: 'On My Team, switch the chart to Bell curve. It shows where everybody sits across the range, with one dot per person. Filter it by month and by Job Role, Core Values or ESMS. An average of 77 can be everybody at 77 or half at 60 and half at 94.',
    ml: 'My Team-ൽ ചാർട്ട് Bell curve-ലേക്ക് മാറ്റുക. ഓരോ ആൾക്കും ഒരു കുത്ത് വീതം, എല്ലാവരും എവിടെ നിൽക്കുന്നു എന്ന് ഇത് കാണിക്കുന്നു. മാസം അനുസരിച്ചും Job Role, Core Values അല്ലെങ്കിൽ ESMS അനുസരിച്ചും ഫിൽട്ടർ ചെയ്യാം. 77 എന്ന ശരാശരി എന്നാൽ എല്ലാവരും 77-ൽ ആകാം, അല്ലെങ്കിൽ പകുതി പേർ 60-ലും പകുതി പേർ 94-ലും ആകാം.',
  },
  'team.p11.what': {
    en: 'Change the month somebody starts from',
    ml: 'ഒരാൾ ഏത് മാസം മുതൽ തുടങ്ങുന്നു എന്നത് മാറ്റുക',
  },
  'team.p11.how': {
    en: 'Open their record from My Team. The start month is at the bottom with their KPI, and you can change it there. It will not go past a month they have already been scored on.',
    ml: 'My Team-ൽ നിന്ന് അവരുടെ റെക്കോർഡ് തുറക്കുക. തുടങ്ങുന്ന മാസം അവരുടെ KPI-യോടൊപ്പം താഴെയുണ്ട്, അവിടെ അത് മാറ്റാം. അവർക്ക് ഇതിനകം സ്കോർ നൽകിയ ഒരു മാസത്തിനപ്പുറത്തേക്ക് ഇത് പോകില്ല.',
  },
  'team.p12.what': {
    en: 'Flag somebody who has left',
    ml: 'ജോലി വിട്ടുപോയ ഒരാളെ അറിയിക്കുക',
  },
  'team.p12.how': {
    en: 'Send it to HR. They deactivate the person. You cannot do it yourself.',
    ml: 'HR-ന് അയയ്ക്കുക. അവർ ആ വ്യക്തിയെ നിഷ്ക്രിയമാക്കും. നിങ്ങൾക്ക് സ്വയം ഇത് ചെയ്യാൻ കഴിയില്ല.',
  },

  // ---- HR ------------------------------------------------------
  'hr.title': {
    en: 'What HR can do',
    ml: 'HR-ന് എന്തൊക്കെ ചെയ്യാം',
  },
  'hr.lead': {
    en: 'You run the system. You are not scored by it.',
    ml: 'നിങ്ങളാണ് ഈ സിസ്റ്റം നടത്തുന്നത്. ഇത് നിങ്ങൾക്ക് സ്കോർ നൽകുന്നില്ല.',
  },
  'hr.p1.what': {
    en: 'See where everybody is',
    ml: 'എല്ലാവരും എവിടെ എത്തി എന്ന് കാണുക',
  },
  'hr.p1.how': {
    en: 'Who has a KPI, who has submitted, who has been scored, and how late each side is.',
    ml: 'ആർക്കൊക്കെ KPI ഉണ്ട്, ആരൊക്കെ സമർപ്പിച്ചു, ആർക്കൊക്കെ സ്കോർ ലഭിച്ചു, ഇരു ഭാഗവും എത്ര വൈകി എന്നിവ.',
  },
  'hr.p2.what': {
    en: 'Manage employees',
    ml: 'ജീവനക്കാരെ കൈകാര്യം ചെയ്യുക',
  },
  'hr.p2.how': {
    en: 'Reporting lines, departments and who is active.',
    ml: 'റിപ്പോർട്ടിംഗ് ക്രമം, ഡിപ്പാർട്ട്മെന്റുകൾ, ആരൊക്കെ സജീവമാണ് എന്നിവ.',
  },
  'hr.p3.what': {
    en: 'Watch the queries',
    ml: 'ചോദ്യങ്ങൾ നിരീക്ഷിക്കുക',
  },
  'hr.p3.how': {
    en: 'Every score somebody has questioned, and how it was answered. View only — the reporting manager answers it.',
    ml: 'ആരെങ്കിലും ചോദ്യം ചെയ്ത എല്ലാ സ്കോറും, അതിന് എങ്ങനെ മറുപടി നൽകി എന്നും. കാണാൻ മാത്രം — മറുപടി നൽകുന്നത് റിപ്പോർട്ടിംഗ് മാനേജരാണ്.',
  },
  'hr.p4.what': {
    en: 'Decide record requests',
    ml: 'റെക്കോർഡ് അപേക്ഷകളിൽ തീരുമാനമെടുക്കുക',
  },
  'hr.p4.how': {
    en: 'Deleting a month, or reopening a KPI. The manager approves first, then you.',
    ml: 'ഒരു മാസം ഇല്ലാതാക്കുക, അല്ലെങ്കിൽ ഒരു KPI വീണ്ടും തുറക്കുക. ആദ്യം മാനേജർ അംഗീകരിക്കുന്നു, പിന്നെ നിങ്ങൾ.',
  },
  'hr.p5.what': {
    en: 'Process leavers',
    ml: 'ജോലി വിട്ടവരെ കൈകാര്യം ചെയ്യുക',
  },
  'hr.p5.how': {
    en: 'A manager flags somebody who has resigned. You deactivate them.',
    ml: 'രാജിവച്ച ഒരാളെ മാനേജർ അറിയിക്കുന്നു. നിങ്ങൾ അവരെ നിഷ്ക്രിയമാക്കുന്നു.',
  },

  // ---- SW Admin ------------------------------------------------
  'sw.title': {
    en: 'What SW Admin can do',
    ml: 'SW Admin-ന് എന്തൊക്കെ ചെയ്യാം',
  },
  'sw.lead': {
    en: "You look after logins and timing. You cannot see anybody's scores.",
    ml: 'നിങ്ങൾ ലോഗിനുകളും സമയക്രമവും നോക്കുന്നു. ആരുടെയും സ്കോർ നിങ്ങൾക്ക് കാണാൻ കഴിയില്ല.',
  },
  'sw.p1.what': {
    en: 'Fix a login',
    ml: 'ഒരു ലോഗിൻ ശരിയാക്കുക',
  },
  'sw.p1.how': {
    en: "Reset somebody's password back to their employee code. You cannot read a password — nobody can.",
    ml: 'ഒരാളുടെ പാസ്‌വേഡ് അവരുടെ എംപ്ലോയി കോഡിലേക്ക് റീസെറ്റ് ചെയ്യുക. ഒരു പാസ്‌വേഡ് വായിക്കാൻ നിങ്ങൾക്ക് കഴിയില്ല — ആർക്കും കഴിയില്ല.',
  },
  'sw.p2.what': {
    en: 'Set the timing rules',
    ml: 'സമയക്രമ നിയമങ്ങൾ സെറ്റ് ചെയ്യുക',
  },
  'sw.p2.how': {
    en: 'How many days each side gets before a month counts as late, and which month to start counting from.',
    ml: 'ഒരു മാസം വൈകിയതായി കണക്കാക്കുന്നതിന് മുമ്പ് ഇരു ഭാഗത്തിനും എത്ര ദിവസം കിട്ടും, ഏത് മാസം മുതൽ എണ്ണിത്തുടങ്ങണം എന്നിവ.',
  },

  // ---- profile -------------------------------------------------
  'prof.title': {
    en: 'Your profile',
    ml: 'നിങ്ങളുടെ പ്രൊഫൈൽ',
  },
  'prof.lead': {
    en: 'Click your own name at the top of any screen to get here.',
    ml: 'ഏത് സ്ക്രീനിന്റെയും മുകളിൽ നിങ്ങളുടെ പേരിൽ ക്ലിക്ക് ചെയ്താൽ ഇവിടെ എത്താം.',
  },
  'prof.p1.what': {
    en: 'Add a photo of yourself',
    ml: 'നിങ്ങളുടെ ഒരു ഫോട്ടോ ചേർക്കുക',
  },
  'prof.p1.how': {
    en: 'Pick any picture from your phone. It is shrunk on your phone before it is sent, so it stays small even on a slow connection. Your face then shows beside your name everywhere in the app.',
    ml: 'നിങ്ങളുടെ ഫോണിൽ നിന്ന് ഏതെങ്കിലും ചിത്രം തിരഞ്ഞെടുക്കുക. അയയ്ക്കുന്നതിന് മുമ്പ് ഫോണിൽ വച്ചുതന്നെ ഇത് ചെറുതാക്കും, അതിനാൽ വേഗത കുറഞ്ഞ കണക്ഷനിലും ഇത് ചെറുതായിരിക്കും. പിന്നീട് ആപ്പിൽ എല്ലായിടത്തും നിങ്ങളുടെ പേരിനൊപ്പം മുഖം കാണിക്കും.',
  },
  'prof.p2.what': {
    en: 'If your photo disappears',
    ml: 'നിങ്ങളുടെ ഫോട്ടോ കാണാതായാൽ',
  },
  'prof.p2.how': {
    en: 'Your reporting manager can remove it, and they have to give a reason. You will see the reason on your profile, and you can add another one straight away.',
    ml: 'നിങ്ങളുടെ റിപ്പോർട്ടിംഗ് മാനേജർക്ക് ഇത് നീക്കം ചെയ്യാം, അവർ ഒരു കാരണം നൽകണം. ആ കാരണം നിങ്ങളുടെ പ്രൊഫൈലിൽ കാണാം, ഉടൻ തന്നെ മറ്റൊരു ഫോട്ടോ ചേർക്കുകയും ചെയ്യാം.',
  },
  'prof.p3.what': {
    en: 'Change your password',
    ml: 'നിങ്ങളുടെ പാസ്‌വേഡ് മാറ്റുക',
  },
  'prof.p3.how': {
    en: 'Any time you like. Nobody can read your password, not even SW Admin.',
    ml: 'എപ്പോൾ വേണമെങ്കിലും. നിങ്ങളുടെ പാസ്‌വേഡ് ആർക്കും വായിക്കാൻ കഴിയില്ല, SW Admin-ന് പോലും.',
  },
  'prof.p4.what': {
    en: 'See where you stand',
    ml: 'നിങ്ങൾ എവിടെ നിൽക്കുന്നു എന്ന് കാണുക',
  },
  'prof.p4.how': {
    en: 'Your profile shows your rank in your team and across Cyrix, out of the people who have been scored.',
    ml: 'സ്കോർ ലഭിച്ചവരിൽ, നിങ്ങളുടെ ടീമിലും Cyrix മുഴുവനിലും നിങ്ങളുടെ റാങ്ക് പ്രൊഫൈലിൽ കാണിക്കും.',
  },

  // ---- things people ask ---------------------------------------
  'ask.title': {
    en: 'Things people ask',
    ml: 'ആളുകൾ ചോദിക്കുന്ന കാര്യങ്ങൾ',
  },
  'ask.p1.what': {
    en: 'Why can I not open this month?',
    ml: 'ഈ മാസം എനിക്ക് എന്തുകൊണ്ട് തുറക്കാൻ കഴിയുന്നില്ല?',
  },
  'ask.p1.how': {
    en: 'A month can only be assessed after it has finished. July opens on 1 August.',
    ml: 'ഒരു മാസം അവസാനിച്ചതിനുശേഷം മാത്രമേ അത് വിലയിരുത്താൻ കഴിയൂ. ജൂലൈ ഓഗസ്റ്റ് 1-ന് തുറക്കും.',
  },
  'ask.p2.what': {
    en: 'Why can I not submit anything?',
    ml: 'എനിക്ക് എന്തുകൊണ്ട് ഒന്നും സമർപ്പിക്കാൻ കഴിയുന്നില്ല?',
  },
  'ask.p2.how': {
    en: 'Your KPI for the year is probably not approved yet. Check with your manager.',
    ml: 'ഈ വർഷത്തെ നിങ്ങളുടെ KPI ഇതുവരെ അംഗീകരിച്ചിട്ടുണ്ടാകില്ല. മാനേജറോട് ചോദിക്കുക.',
  },
  'ask.p3.what': {
    en: 'Where do I see which month my KPI starts from?',
    ml: 'എന്റെ KPI ഏത് മാസം മുതൽ തുടങ്ങുന്നു എന്ന് എവിടെ കാണാം?',
  },
  'ask.p3.how': {
    en: 'On My KPI, at the top, above your KRAs. If it looks wrong, ask your manager — they can change it.',
    ml: 'My KPI-യിൽ, ഏറ്റവും മുകളിൽ, നിങ്ങളുടെ KRA-കൾക്ക് മുകളിൽ. തെറ്റാണെന്ന് തോന്നിയാൽ മാനേജറോട് ചോദിക്കുക — അവർക്ക് ഇത് മാറ്റാം.',
  },
  'ask.p4.what': {
    en: 'It asked me which month my KPI starts from',
    ml: 'എന്റെ KPI ഏത് മാസം മുതൽ തുടങ്ങുന്നു എന്ന് ഇത് എന്നോട് ചോദിച്ചു',
  },
  'ask.p4.how': {
    en: 'Because nobody had said yet, and until somebody does you are counted as owing every month since April. Pick the month you joined if you joined this year, April if you did not. Your manager can correct it.',
    ml: 'ആരും ഇതുവരെ പറഞ്ഞിട്ടില്ലാത്തതുകൊണ്ടാണ്. ആരെങ്കിലും പറയുന്നതുവരെ ഏപ്രിൽ മുതലുള്ള എല്ലാ മാസവും നിങ്ങൾ ചെയ്യേണ്ടതായി കണക്കാക്കും. ഈ വർഷം ചേർന്നതാണെങ്കിൽ ചേർന്ന മാസം തിരഞ്ഞെടുക്കുക, അല്ലെങ്കിൽ ഏപ്രിൽ. നിങ്ങളുടെ മാനേജർക്ക് ഇത് തിരുത്താം.',
  },
  'ask.p5.what': {
    en: 'Why are the first months of the year missing from my history?',
    ml: 'എന്റെ ചരിത്രത്തിൽ വർഷത്തിന്റെ ആദ്യ മാസങ്ങൾ എന്തുകൊണ്ട് ഇല്ല?',
  },
  'ask.p5.how': {
    en: 'Your KPI starts later than April, so those months are not yours. Any month you have actually been scored on is always shown.',
    ml: 'നിങ്ങളുടെ KPI ഏപ്രിലിനുശേഷമാണ് തുടങ്ങുന്നത്, അതിനാൽ ആ മാസങ്ങൾ നിങ്ങളുടേതല്ല. നിങ്ങൾക്ക് യഥാർഥത്തിൽ സ്കോർ ലഭിച്ച ഏത് മാസവും എപ്പോഴും കാണിക്കും.',
  },
  'ask.p6.what': {
    en: 'I sent the wrong month in',
    ml: 'ഞാൻ തെറ്റായ മാസം അയച്ചു',
  },
  'ask.p6.how': {
    en: 'Ask for it to be deleted. Your manager reviews it, then HR. Nothing is removed until both agree.',
    ml: 'അത് ഇല്ലാതാക്കാൻ അപേക്ഷിക്കുക. ആദ്യം നിങ്ങളുടെ മാനേജർ പരിശോധിക്കുന്നു, പിന്നെ HR. രണ്ടുപേരും സമ്മതിക്കുന്നതുവരെ ഒന്നും നീക്കം ചെയ്യില്ല.',
  },
  'ask.p7.what': {
    en: 'Can I query a score twice?',
    ml: 'ഒരു സ്കോറിനെക്കുറിച്ച് രണ്ടു തവണ ചോദിക്കാമോ?',
  },
  'ask.p7.how': {
    en: 'No. One query per month, so put everything into the one you raise.',
    ml: 'ഇല്ല. മാസത്തിൽ ഒരു ചോദ്യം മാത്രം, അതിനാൽ ഉന്നയിക്കുന്ന ആ ഒന്നിൽ എല്ലാം ഉൾപ്പെടുത്തുക.',
  },
  'ask.p8.what': {
    en: 'It says it cannot see a face in my photo',
    ml: 'എന്റെ ഫോട്ടോയിൽ മുഖം കാണാൻ കഴിയുന്നില്ല എന്ന് പറയുന്നു',
  },
  'ask.p8.how': {
    en: 'That is a warning, not a refusal — you can carry on. Some phones cannot check at all, and no check spots every face.',
    ml: 'അത് ഒരു മുന്നറിയിപ്പാണ്, തടയലല്ല — നിങ്ങൾക്ക് തുടരാം. ചില ഫോണുകൾക്ക് ഇത് പരിശോധിക്കാൻ കഴിയില്ല, ഒരു പരിശോധനയും എല്ലാ മുഖവും കണ്ടെത്തുകയുമില്ല.',
  },
  'ask.p9.what': {
    en: 'My row measures something else this month',
    ml: 'ഈ മാസം എന്റെ വരി മറ്റൊന്നാണ് അളക്കുന്നത്',
  },
  'ask.p9.how': {
    en: 'If your KPI has alternatives on that row, pick the right one at the top of it. Changing it clears what you typed on that row, because it was counting something else.',
    ml: 'ആ വരിയിൽ നിങ്ങളുടെ KPI-ക്ക് പകരം ഓപ്ഷനുകൾ ഉണ്ടെങ്കിൽ, അതിന്റെ മുകളിൽ നിന്ന് ശരിയായത് തിരഞ്ഞെടുക്കുക. ഇത് മാറ്റുമ്പോൾ ആ വരിയിൽ നിങ്ങൾ എഴുതിയത് മായ്ക്കും, കാരണം അത് മറ്റൊന്നാണ് എണ്ണിയിരുന്നത്.',
  },
  'ask.p10.what': {
    en: 'It says others doing my job score higher',
    ml: 'എന്റെ ജോലി ചെയ്യുന്ന മറ്റുള്ളവർക്ക് കൂടുതൽ സ്കോർ ഉണ്ടെന്ന് പറയുന്നു',
  },
  'ask.p10.how': {
    en: 'That is an average of everybody with the same KPI as you, and only ever shows when at least three of you have been scored. You are never shown one person, and nobody is shown yours.',
    ml: 'നിങ്ങളുടേതിന് തുല്യമായ KPI ഉള്ള എല്ലാവരുടെയും ശരാശരിയാണ് അത്. നിങ്ങളിൽ കുറഞ്ഞത് മൂന്നു പേർക്ക് സ്കോർ ലഭിച്ചാൽ മാത്രമേ ഇത് കാണിക്കൂ. ഒരൊറ്റ വ്യക്തിയുടെ സ്കോർ നിങ്ങൾക്ക് ഒരിക്കലും കാണിക്കില്ല, നിങ്ങളുടേത് ആർക്കും കാണിക്കില്ല.',
  },
  'ask.p11.what': {
    en: 'What do the colours mean?',
    ml: 'നിറങ്ങൾ എന്താണ് അർഥമാക്കുന്നത്?',
  },
  'ask.p11.how': {
    en: 'Red is Poor and yellow is Satisfactory — those two are below what your manager expects. Good, Very Good and Excellent are all green, getting deeper as the score rises, because Good already means you are doing the job as expected. Each score is coloured against what it was out of, not out of 100.',
    ml: 'ചുവപ്പ് Poor, മഞ്ഞ Satisfactory — ഈ രണ്ടും നിങ്ങളുടെ മാനേജർ പ്രതീക്ഷിക്കുന്നതിലും താഴെയാണ്. Good, Very Good, Excellent എന്നിവ പച്ചയാണ്, സ്കോർ കൂടുന്തോറും കടും പച്ചയാകും, കാരണം Good എന്നാൽ തന്നെ നിങ്ങൾ പ്രതീക്ഷിച്ചതുപോലെ ജോലി ചെയ്യുന്നു എന്നാണ്. ഓരോ സ്കോറിനും അതിന്റെ സ്വന്തം പരമാവധിക്ക് അനുസരിച്ചാണ് നിറം, 100-ന് അനുസരിച്ചല്ല.',
  },
  'ask.p12.what': {
    en: 'I forgot my password',
    ml: 'ഞാൻ എന്റെ പാസ്‌വേഡ് മറന്നു',
  },
  'ask.p12.how': {
    en: 'Ask SW Admin to reset it. It goes back to your employee code.',
    ml: 'റീസെറ്റ് ചെയ്യാൻ SW Admin-നോട് ആവശ്യപ്പെടുക. ഇത് നിങ്ങളുടെ എംപ്ലോയി കോഡിലേക്ക് മടങ്ങും.',
  },
}
