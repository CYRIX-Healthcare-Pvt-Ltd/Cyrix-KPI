-- Name the four scoring rules by what actually separates them.
--
-- The old names described their arithmetic -- "proportional penalty",
-- "linear, can go negative" -- which is the one thing the person choosing
-- does not need to know and cannot check. What they need to know is where
-- the score can end up, and now that both lower rules take a rate per
-- unit over (see calcKpiScore), that is the only thing left between them:
-- one stops at zero, the other does not.
--
-- The codes are untouched. They are what every assignment row stores and
-- what the scoring engine switches on; only what a person reads changes.
update public.scoring_rules set
  label = 'Higher is better (max weightage)',
  description = 'Score rises with what was achieved and stops at the full weightage — hitting the target is full marks, beating it adds nothing. Example: target 50 visits, weightage 10. 40 visits scores 8; 50 or more scores 10.'
where code = 'higher_capped';

update public.scoring_rules set
  label = 'Higher is better (can exceed weightage)',
  description = 'Score rises with what was achieved and keeps rising past the weightage, so beating the target is rewarded. Example: target 50 visits, weightage 10. 40 visits scores 8; 50 scores 10; 60 scores 12.'
where code = 'higher_uncapped';

-- Both lower rules now read the same way and describe the same setting,
-- because they now take the same setting. The example is the same figures
-- through both, so the difference is the only thing that moves.
update public.scoring_rules set
  label = 'Lower is better (min 0 %)',
  description = 'At or under the target scores the full weightage. Going over reduces it, and it never falls below zero. Set a fixed amount to take off for each one over — target 2 complaints, weightage 10, 2 per unit: 3 complaints scores 8, 6 complaints scores 0 and stays there. Leave it unset and the reduction is proportional instead: 3 scores 6.67, 4 scores 5.'
where code = 'lower_penalty';

update public.scoring_rules set
  label = 'Lower is better (can go below 0 %)',
  description = 'At or under the target scores the full weightage. Going over reduces it, and it keeps going once it passes zero, so a bad month can cost the rest of the scorecard. Set a fixed amount to take off for each one over — target 2 complaints, weightage 10, 2 per unit: 3 complaints scores 8, 6 complaints scores 0, 8 scores -4. Leave it unset and each one over takes an equal slice of the weightage.'
where code = 'lower_linear';

notify pgrst, 'reload schema';
