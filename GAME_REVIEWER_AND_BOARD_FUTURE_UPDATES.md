Notes 20260524

# On updatign and refining engine evaluations to human readable evaluations

- Read up and work on Positional Influence Rating System (PIRS) - A quantitative framework for Chess Evaluations

# Source: chess com -> forum -> introducing-the-positional-influence-rating-system... posted by user:fishers_bane

# On board decorations, heat maps, threat detetion etc. see deepseek sources in chat

# On after game review/game input
- Add create library action next to add game details
-- Modal, popup should render folder structure with group --> games/postions in hierarchy (like how a file explorer works)
-- Introduce local store db with caching and updates for offline mode even on reloads or exits (as long as browser cahce not deleted)

# On gmae/postion library feature add some metadata attributes like session, date, averages etc.

#Issues to fix

- Fix scroll effect when cycling through moves on mobile. The screen follows the highlighted move and moves away from the board. Should keep screen static and not be affected by moves either on the moves list or anywhere else
- Create server logs to follow execution of game reviewer with results dumped to the console along withb funcitonand file that called it
- Resoolve opneing book bug
- Add multiple games at once or input/load a game, click add and load another and when done export all games as pgn sort of feature
- Include a feature in game reviewer for coach notes/comments on the moves
- Fix the termination error or last line edge case parsing for pgn files

