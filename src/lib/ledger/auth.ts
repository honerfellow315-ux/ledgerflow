// Historical duplicate of the login/logout/me server functions. The single
// source of truth is now src/lib/actions/auth.ts (it also records the
// login / login_failed / logout activity-log entries). Re-exported here so
// any old import keeps working.
export { login, logout, me } from "../actions/auth";
