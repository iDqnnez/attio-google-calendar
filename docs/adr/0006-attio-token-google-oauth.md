# Workspace token for Attio, OAuth for Google

The Operator supplies an Attio workspace access token (single-workspace, env). Google is OAuth, with a scope that can create the dedicated Calendar (`calendar.app.created` or `calendar`), and the refresh token is stored after a one-time connect. This is not an Attio marketplace app; Attio App KV is documented as transient and is not the Binding store.
