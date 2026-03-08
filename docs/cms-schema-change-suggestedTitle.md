# CMS Schema Change — Make `suggestedTitle` Optional

Copy everything between the `---` markers below and give it to whoever works on the CMS repo.

---

## Make `suggestedTitle` optional on the `content-queue` collection

### What needs to happen

The `suggestedTitle` field on the `content-queue` collection is currently required. It needs to become optional so that queue items can be created without providing a title.

The field itself should stay exactly as-is — same name, same type, same position in the schema. The only change is removing the requirement that it must be filled in. If there's any custom validation enforcing a non-empty value, that should be removed too.

### Why this matters

The blog engine has been updated so that AI now generates SEO-optimized titles during article writing. When a queue item has a `suggestedTitle`, the AI uses it as a hint for the angle/direction. When it's missing, the AI generates the title entirely on its own based on competitor analysis and the target keyword.

The title resolution works like this: the AI-generated title is used first. If the AI somehow doesn't produce one, it falls back to `suggestedTitle`. If that's also empty, it falls back to the `keyword` field.

This means `suggestedTitle` has shifted from being "the title" to being "optional creative direction." Making it optional lets us:

- Queue articles with just a keyword and slug, which speeds up content planning significantly
- Let the AI produce better, more competitive titles informed by real-time competitor research
- Still guide the AI's angle when we want to by providing a suggestedTitle

### What NOT to change

- Do not rename the field — it must stay as `suggestedTitle`
- Do not change the field type — it stays as text
- Do not touch any other fields on the collection
- Do not remove the field from the admin UI — it should still be visible and editable, just not required
- Optionally, you can update the admin description/help text to say something like "Optional — AI generates titles when left blank"

### How to verify it works

After deploying, create a queue item via the API **without** a `suggestedTitle` field in the body. Send a POST to `/api/content-queue` with just these fields: `keyword`, `airportCode`, `slug`, `articleType`, `priority`, and `status`. It should succeed. Previously this would fail with a validation error about `suggestedTitle` being required.

Then create another queue item **with** a `suggestedTitle` to confirm that still works normally too.

Delete both test items when done.

---
