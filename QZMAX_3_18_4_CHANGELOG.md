# QZMAX 3.18.4 — Streamlined Create + Session Controls + Player Ranking

## Creation changes
- Removed **QZMAX Library** from the Create interface.
- Removed **Puzzle Mode** from the Create interface.
- Removed automatic Puzzle Bank startup loading from the active creator flow.
- AI Generator, School / Education, My Document, Source Link and Manual remain available.
- AI Generator architecture from 3.18.3 is unchanged.

## Bible AI topic cleanup
Removed from the Bible & Christianity AI topic list:
- Orthodox Study Bible — Mixed
- Orthodox Canon
- OSB Introduction

Added clearer Bible / Christianity choices including Old Testament, New Testament, Psalms, Life of Jesus, Miracles & Parables, Apostles, Bible Places, Coptic Orthodox Church, Church History, Saints & Martyrs, Sacraments and Liturgical Year.

## Expanded AI categories and topics
Added and expanded quiz-friendly categories including:
- Food & Drink
- Travel & Landmarks
- Games & Gaming
- Pop Culture & Celebrities
- Cars, Transport & Aviation
- Health & Human Body
- Nature & Animals
- Language & Words
- Religion & World Faiths
- Kids & Family

Existing categories were also expanded with more specific topics for History, Geography, Science, Technology, Film & TV, Music, Sports, Arts & Literature, Culture, Business and Current Affairs.

## Fresh-session reset
- Added **Reset session** controls to host Setup, Live Question, Exam, Reveal, Leaderboard, Final Results and the Dashboard active-session card.
- Reset ends the old Firebase room, disconnects all joined players, clears live answers / unsaved queue and creates a brand-new session code.
- Saved quizzes are not deleted.
- Players still connected to the old room are shown the normal session-ended screen.

## Joined-player roster
- Host Setup now includes a live **Lobby roster** with player names, not only a count.
- Team mode shows each player's team next to their name.
- The host Dashboard active-session card also shows joined player names (first 12, then a remainder count).

## Player ranking
- During later questions, players see their current rank on the question screen.
- The answer reveal now shows current rank alongside total score and question number.
- Player leaderboard wording now includes rank out of total players.
- Players outside the visible Top 8 / Top 5 still receive their own highlighted ranking row/card.
- Final results explicitly show **Final rank #X of Y**.
- Team mode shows both team standing and individual standing.

## Security investigation
See `QZMAX_ANTI_CHEAT_INVESTIGATION.md` for the recommended answer-key / screen-reading defence architecture. No invasive anti-cheat behaviour was added in this maintenance build.
