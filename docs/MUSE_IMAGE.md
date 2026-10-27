# Muse Image: plan for the trend summary card

Status: **ready to switch on, not yet run against the live API.** Ando renders the
card today with the pet's photo as the illustration. Muse Image replaces only that
illustration once the team has access.

## What the card is for

The summary card is a 4:5 PNG (`GET /api/pets/:id/card`) that an owner can send to
family or attach when booking a vet visit. It shows the pet, the current level, a
one-line headline ("Raised for several days — time to check in with a vet") and the
14-day trend.

## Key design decision: the model never draws data

Image models are unreliable with text and numbers: they misspell words, invent axis
labels and redraw a trend as a pretty but wrong curve. On a health card, a wrong
number is worse than no number. So the card has two layers:

| Layer | Made by | Content |
| --- | --- | --- |
| Illustration (top 720 px) | **Muse Image** (`/v1/images/edits` with the pet photo, or `/v1/images/generations` without one) | stylized portrait of *this* pet, mood matched to the level |
| Data (bottom 630 px) | **Ando** (`src/lib/report/card.ts`, SVG → PNG with sharp) | name, level badge, headline, trend line, cut-off, disclaimer |

The prompt (`cardPrompt` in `src/lib/meta/museImage.ts`) asks for no text, no
letters, no numbers and no medical equipment, and leaves empty space for the layout.

## Safety rules for the prompt

* Never depict pain, injury, illness, vets, cones or bandages. The card is shared
  with family, and a picture of a suffering pet would read as a diagnosis.
* An elevated level maps to "resting comfortably, calm and cared for", not "sad".
* The coat colours and markings come from the owner's own photo through the edits
  endpoint, so the pet is recognisable without the model inventing a breed.

## What to verify in Meta's docs first

Sources disagree on some details, and the docs at dev.meta.ai weren't reachable from
the build environment. Check these on <https://dev.meta.ai/docs/image-generation>:

1. **Model ID**: `muse-image-1.0` (set with `MUSE_IMAGE_MODEL`).
2. **Edits input**: does `/v1/images/edits` take `image` as multipart (OpenAI style,
   which is what the SDK's `images.edit` sends) or as a URL/base64 field?
3. **Size**: third-party gateways list both `1024x1024`-style sizes and aspect names
   (`PORTRAIT_3_4_1K`). The card crops to 1080×720 with `fit: cover`, so any landscape
   or square output works; pass `size` only once the accepted values are confirmed.
4. **`response_format`**: `b64_json` (documented default) vs `url`.
5. **Content policy** for animal likeness edits.

## Switching it on

```bash
MUSE_IMAGE_ENABLED=true
# MUSE_IMAGE_MODEL=muse-image-1.0
```

Then open `/api/pets/<id>/card`. The first render per (pet, level) calls Muse Image
and caches the result at `storage/media/pets/<id>/card-art-<level>.png`. Later
renders cost nothing. If the call fails, the card falls back to the photo and logs
a warning; it never blocks.

Contract test: `tests/card.test.ts` runs the flag-on path through the real OpenAI
SDK against `scripts/mock-meta.ts`. It checks that a photo goes to the edits endpoint
and that the second render uses the cache.

## Cost and caching

There are at most 3 illustrations per pet (one per level), regenerated only when the
owner changes the photo (delete `card-art-*`). Third-party listings price Muse Image
at about $0.01 per image, so a 100-pet beta costs about $3 in total.

## Evaluation before demo day

* Generate cards for 10 real pet photos (cats and dogs, light and dark coats).
* Reject if there is any text or number in the illustration, the wrong species, or
  markings that don't match.
* Show 5 owners their pet's card next to the photo-only fallback and ask which one
  they would send. If the photo wins, keep the photo.

## Later ideas

* Use the **edits** endpoint with the latest SAM 3.1 body mask: cut the pet out of
  the real key frame and restyle only the background. That keeps true likeness and
  avoids any generated anatomy.
* Use the Responses API for multi-turn refinement ("warmer light", "less busy
  background") in an owner-facing editor.
