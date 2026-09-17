# Task Calendar Projection

Projects Attio tasks onto a dedicated Google calendar so an operator can see deadlines on a calendar. Attio is authoritative; the calendar is derived.

## Language

**Operator**:
The person who runs one instance of this project, with one Attio workspace and one Google account.
_Avoid_: user, customer, tenant

**Connection**:
The pairing of one Attio workspace with one dedicated Google calendar belonging to one Google account.
_Avoid_: account, integration, sync config

**Connection timezone**:
The IANA timezone on the Connection used to turn a Deadline into a civil date.
_Avoid_: UTC (as the implicit zone), Google calendar timezone

**Task**:
An Attio task in the connected workspace.
_Avoid_: to-do, item, card

**Deadline**:
The Task’s deadline. A Task with no Deadline is not projected.
_Avoid_: due date, due at

**Open Task**:
A Task that is not completed.
_Avoid_: incomplete, active, outstanding

**Qualifying Task**:
A Task that has a Deadline. Completion does not disqualify it; absence of a Deadline does.
_Avoid_: syncable task, in-scope task

**Calendar**:
The dedicated Google calendar created for the Connection, not the Operator’s primary calendar.
_Avoid_: primary calendar, Google account

**Event**:
A Google Calendar event that is the projection of exactly one Qualifying Task. It is all-day on the civil date of the Deadline in the Connection timezone. Its description is the Task URL.
_Avoid_: meeting, appointment, calendar item

**Task URL**:
The Attio web app URL that opens a Task.
_Avoid_: API URL, permalink

**Binding**:
The durable relationship between one Task and one Event.
_Avoid_: mapping, link, sync record, foreign key

**Authority**:
Attio. Task state is authoritative; Event state is derived.
_Avoid_: source of truth, master

**Projection**:
Applying current Task state onto its Event: create, update, or remove the Event. A Binding is not required to remove an Event that is already present.
_Avoid_: synchronization, two-way sync, replication

**Backfill**:
The one-time Projection of existing Open Qualifying Tasks when the Connection is established.
_Avoid_: import, initial sync, historical sync

**Catch-up**:
A periodic Projection of Open Qualifying Tasks and every Task that already has a Binding, to repair missed webhooks.
_Avoid_: full sync, resync, poll

**Heal**:
Creating the Event again when it is missing, because Attio is Authority.
_Avoid_: restore (that would mean honouring a Calendar-side delete)

**Completion**:
A Task marked complete. The Event remains and is updated. Completion is not Deletion.

**Deletion**:
A Task removed in Attio. The Event is removed if it exists; the Binding ends if it exists.
_Avoid_: archive
