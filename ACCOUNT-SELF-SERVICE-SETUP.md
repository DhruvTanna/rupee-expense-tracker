# Account self-service setup

The tracker Settings page now contains **Change password** and **Delete my account** for signed-in users.

## Status

The `delete-account` Supabase Edge Function has been deployed to the Expense Tracker project. It accepts only POST requests from the published GitHub Pages origin, validates the caller's user token with Supabase Auth, and deletes only the authenticated caller. Supabase's existing `user_id ... references auth.users(id) on delete cascade` relationship removes that user's tracker snapshot.

Password changes use the signed-in user's Auth session through Supabase Auth's `PUT /auth/v1/user` endpoint. The page asks for the current password, re-authenticates, and then sets the new password.

## Source

- Website: `index.html`
- Edge Function: `supabase/functions/delete-account/index.ts`

The service key is read only inside the Edge Function runtime. It is never placed in the website or sent from the browser.

## Supabase dashboard location

Edge Functions → `delete-account` → Code. Keep **Verify JWT with legacy secret** enabled. The function independently verifies the user's access token before deleting anything.

