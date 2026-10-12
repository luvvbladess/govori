# Group conversations and chat font review

Checked the published https://lexiqs.space release on 2026-10-11.

- 58 automated tests passed, including legacy database migration, independent rooms, four participants, per-language translation caching, membership privacy, late arrivals and retry after a partial translation failure.
- Production provider check: three test participants using Russian, English and Spanish exchanged messages; each recipient received their language translation. Two separately named rooms appeared in History and could be reopened independently.
- Shared controls no longer occupy the chat: the toolbar is inside the room settings dialog opened using the footer ellipsis. Invitation links and the participant list remain accessible there.
- The Aa control offers 16, 18, 20 and 24 px. Computed browser styles confirmed that both original messages and translations change together. The default is 18 px. Selecting 16 px persisted through page reload.
- Browser viewport checks at 320, 390 and 1280 px found no horizontal document overflow. No browser console errors were recorded. This is browser viewport testing, not a physical iPhone or Safari device test.
- The design detector reported no non-advisory findings. Its 73 advisory findings concern values outside the existing DESIGN.md font, radius and color lists. No new suppression was added for this change; the existing narrowly scoped intentional Inter exception remains.
- Disposable production QA rooms, messages, translations and the test account were removed after verification; local files holding the temporary email and invite token were removed as well.

Screenshots: [390 px](groups-font-mobile.jpg), [320 px](groups-font-320.jpg), [desktop](groups-font-desktop.jpg).
