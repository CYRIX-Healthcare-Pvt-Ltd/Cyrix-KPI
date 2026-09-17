// What each video says, step by step. The step keys match the marks the
// recording scripts make, and the wording follows the user manual's own
// section for that video, so the two never disagree.
export const VIDEOS = {
  '1-your-kpi': {
    number: 1,
    of: 4,
    section: 'Your KPI for the year',
    subtitle: 'Set it up from your Excel sheet and send it to your manager',
    next: 'Next · 2. Your manager approves it',
    who: 'Kevin - Test, a team member',
    overlays: [{ image: 'sheet', from: 'fill', to: 'upload' }],
    steps: {
      en: {
        intro: ['Your KPI for the year', 'The list of things you are measured on. You set it up once a year.'],
        open: ['Open My KPI', 'Then press Set up my KPI.'],
        choices: ['Three ways to start', 'Upload your Excel sheet, use a team template your manager keeps, or build the rows by hand.'],
        template: ['Upload my Excel', 'Download the template first. It has the columns the app reads.'],
        fill: ['Fill in your job role rows', 'KRA, KPI, weightage, target and how each is scored. Job Role is 80 marks; core values are the other 20.'],
        upload: ['Upload from device', 'Pick the filled-in sheet. The app reads every row from it.'],
        rows: ['Check the rows', 'Everything is editable here. Correct anything that came through wrong before you send it.'],
        rules: ['How each row is scored', 'Each rule has its own colour. Green stops at your weightage; red can take marks off your other rows.'],
        start: ['Say which month it starts from', 'April if you were here all year. If you joined later, the month you joined.'],
        send: ['Submit to my manager', 'Your manager has to approve it. You cannot start any month until they do.'],
        end: ['Sent for approval', 'If it comes back with a reason, change it and send it again.'],
      },
    },
  },
  '2-approve': {
    number: 2,
    of: 4,
    section: 'Approve their KPI',
    subtitle: 'Review a team member’s KPI, correct it, keep it as a template and approve it',
    next: 'Next · 3. Filling in the month',
    steps: {
      en: {
        intro: ['Approve their KPI', 'Nobody on your team can start a month until you approve their KPI. The number on Approvals is how many are waiting.'],
        open: ['Open Approvals', 'Everybody whose KPI is waiting for you is listed here.'],
        review: ['Press Review', 'Every row is shown: KRA, KPI, weightage, target and how it is scored.'],
        start: ['Check the start month', 'Somebody who joined in August is not asked for April to July. You can change it here.'],
        rules: ['Look at the scoring colours', 'Green stops at the weightage. Amber can cost the row its own marks. Red can take marks off the rest of the month.'],
        edit: ['Correct it with Edit', 'Fix a KRA, weightage, target or scoring rule. It saves as you leave each field — no need to send it back.'],
        template: ['Save as team template', 'Keep these rows under a name. Your direct reports can then start their own KPI from it.'],
        approve: ['Approve', 'The KPI is in force for the year, and monthly assessments can start.'],
        end: ['Nothing left waiting', 'Send back is there for anything the team member should rethink themselves.'],
      },
    },
  },
  '3-month': {
    number: 3,
    of: 4,
    section: 'Every month',
    subtitle: 'Fill in what you achieved and send it to your manager',
    next: 'Next · 4. Your manager scores the month',
    steps: {
      en: {
        intro: ['Every month', 'Once a month, for the month that has just finished. The dashboard tells you which one is due.'],
        open: ['Start the month', 'Press Start now, then Start Aug-26.'],
        enter: ['Enter what you achieved', 'Put the real number against each target. The app works out your score as you type.'],
        core: ['You do not rate the core values', 'Your manager rates all five when they score you. They are still worth the same 20 marks.'],
        remarks: ['Anything to add?', 'Optional. Context your manager should know when they score the month.'],
        send: ['Submit to manager', 'Send it soon after the month ends. Past the allowance it counts as late.'],
        end: ['Awaiting manager', 'Your manager enters their own figures and rates the core values. Their score is your final score.'],
      },
    },
  },
  '4-score': {
    number: 4,
    of: 4,
    section: 'Score their months',
    subtitle: 'Enter your figures, rate the core values and submit',
    next: 'The team member sees the score now, and can query it while the month is open',
    steps: {
      en: {
        intro: ['Score their months', 'The number on My Team is how many months are waiting for your score.'],
        open: ['Open the month', 'On My Team, press Score beside the person. What they claimed is shown beside your figures.'],
        figures: ['Enter your own figure for each row', 'Your score is the final score. You can correct a target too, because you know the right number.'],
        reason: ['Say why if you score much lower', 'More than 5 points below their own job role total, and a reason is required. They see it with the score.'],
        core: ['Rate every one of the core values', 'All five are required. The month cannot be submitted with any of them blank.'],
        low: ['A low rating needs a reason', 'Satisfactory or Poor asks for a short reason, so the person knows what to change.'],
        remarks: ['Your remarks', 'Optional feedback on the month, shown to the team member.'],
        submit: ['Submit my scores', 'Confirm once. You can still correct anything while the month is open, and they can raise a query.'],
        end: ['Manager reviewed', 'The team member can see the score and how each part was marked.'],
      },
    },
  },
}
