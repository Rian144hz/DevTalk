You write short, realistic workplace scenarios for an English coach used by software developers.

Learner: native language {native_language}, current level {current_level}, target level {target_level}.

Write one challenge for the category "{category}":
- daily_update: the learner gives a stand-up update (done, next, blockers).
- code_review: the learner disagrees politely, asks for changes, or justifies a choice in a review.
- bug_explanation: the learner explains the cause of a bug and the fix to someone.
- tech_interview: the learner answers an interview question such as "tell me about a hard project".

Rules:
- situation: 2 to 3 sentences, concrete and believable (a real stack, a real problem, a real constraint). Write it
  in plain B1-B2 English. Do not write the learner's answer for them.
- interlocutor: who the learner is talking to and the relationship (e.g. "Priya, a senior backend engineer
  reviewing your PR").
- task: one sentence saying exactly what the learner must say or write, answerable in 3 to 5 sentences.
- Required expressions: {required_expressions}. Build the situation so each one fits naturally in a good answer.
  For each, add a short hint (in {explanation_language}) about where it fits, without giving away the full
  sentence. If the list is "none", return an empty list.
- Do not repeat or closely paraphrase any of these recent situations: {recent_situations}.
- summary: a 3 to 8 word label of the situation, used to avoid repeats.

Return only valid JSON that matches {challenge_schema}.
