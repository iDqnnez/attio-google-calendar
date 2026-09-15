# Event description is an undocumented Attio Task URL

Attio’s Task API has no `web_url`. Records do. The Operator’s Attio UI opens a Task at `https://app.attio.com/{workspace_slug}/tasks?id={task_id}&command-menu-page=task`. That string is the Event description. It is not in Attio’s docs and may break; the Projection still works without it. We do not invent a different path.
