# All-day Events on the Connection timezone date

A Task is a deadline, not a meeting. Attio does not give a duration. Google Events are all-day or timed, never mixed. Each Qualifying Task is an all-day Event on the civil date of the Deadline in the Connection timezone (`start.date = D`, exclusive `end.date = D+1`). Google ignores timezone on all-day Events, so the date we send must already be the Operator’s day, not UTC by default.
