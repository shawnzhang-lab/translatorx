# Privacy

Effective: July 28, 2026

TranslatorX is a GitHub-only, bring-your-own-key Chrome extension. It has no TranslatorX account, developer-operated backend, analytics, advertising, or telemetry.

## Data the extension handles

Depending on the feature you use, TranslatorX handles:

- the canonical URL and video ID of the active YouTube video;
- transcript text and timestamps;
- video metadata such as title, channel, description, and duration;
- text you select in the transcript and nearby transcript context;
- transcript context around a timestamped note;
- content you ask to translate;
- notes you save;
- Supadata and DeepSeek configuration, including API keys; and
- cached transcript, digest, and translation results.

## Where data goes

### YouTube and optional Supadata fallback

TranslatorX first reads the active player's available manual or automatic caption track and downloads that caption track directly from YouTube. If direct retrieval fails and you configured a Supadata key, the extension sends the canonical video URL to `https://api.supadata.ai` and uses the returned transcript and timestamps. Supadata is optional and is never contacted after a successful direct retrieval.

### DeepSeek

The published version sends AI feature content to DeepSeek V4 Flash at `https://api.deepseek.com`:

- transcript plus relevant title, channel, description, or duration for an overview;
- selected text plus nearby transcript context for an explanation;
- small semantic transcript batches currently needed for progressive Chinese
  translation, or requested overview or explanation content;
- nearby transcript context and video metadata when polishing a saved note.

The endpoint and `deepseek-v4-flash` model are fixed in the published Settings page. You provide one DeepSeek API key. A separately adapted local source copy may use different endpoints or permissions, but that is outside the published Settings interface.

Requests go directly from the extension to YouTube, optional Supadata fallback, or DeepSeek. Provider requests are authenticated with the keys you supply. TranslatorX's developer does not proxy or receive these requests.

Those services process data under their own terms, privacy policies, retention practices, and account settings. Do not send confidential, personal, or regulated content unless their terms and your obligations permit it.

## Local storage and retention

TranslatorX uses Chrome's local extension storage, not a TranslatorX cloud service.

- Supadata and DeepSeek settings and API keys remain on the device in Chrome's extension storage.
- Saved notes remain until you delete them or remove/clear the extension's data. The extension keeps up to 100 notes.
- Recent transcript, digest, and transcript or overview translation cache entries are stored
  locally. The cache is limited to 20 videos, and entries older than 30 days are
  removed when the side panel opens.
- Simplified Chinese note translations are stored with the corresponding saved
  note and follow the same deletion and 100-note retention behavior.
- The preferred Explain display mode (English, Simplified Chinese, or bilingual)
  is stored locally until you change it or reset the extension's data.

Chrome extension storage is not a password vault. Anyone with sufficient access to your browser profile or device may be able to recover locally stored keys or content. Use scoped keys where providers support them, set spending limits, and rotate or revoke a key if the device or browser profile is compromised.

To remove data:

- delete individual saved notes in TranslatorX;
- use the Options page to clear cached digests, delete all notes, or reset all extension data;
- remove the extension or clear its stored data from Chrome to delete all local settings, keys, notes, and cache entries; and
- revoke keys in the Supadata or DeepSeek dashboard to stop their future use.

Clearing local data does not delete information already processed or retained by Supadata or DeepSeek. Use each service's controls for service-side requests.

## Permissions

TranslatorX uses Chrome permissions for these purposes:

- `sidePanel`: display the TranslatorX interface beside YouTube.
- `storage`: store settings, keys, notes, and cached results locally.
- `tabs`: identify and interact with the active YouTube tab.
- `scripting`: coordinate the extension's YouTube page controls.
- YouTube host access: read the active video's URL, metadata, and available caption track, download that track, and provide timestamp controls.
- Supadata host access: retrieve a transcript only when direct YouTube caption retrieval fails and a fallback key is configured.
- DeepSeek host access: provide AI overviews, explanations, translation, and note polishing through DeepSeek V4 Flash.

TranslatorX does not use these permissions to monitor general browsing activity.

## No sale or advertising use

TranslatorX does not sell personal information, build advertising profiles, or share data with data brokers. It does not include analytics SDKs.

## Changes

Privacy-relevant changes will be documented in this file and in the repository history. Review updates before installing a new version.

## Questions

For general questions and reproducible bugs that contain no private data, use the repository's [Issues](https://github.com/shawnzhang-lab/translatorx/issues). Review this policy, the source code, and each provider's documentation before using the extension. For a vulnerability or accidental secret exposure, follow the private process in [SECURITY.md](SECURITY.md).
