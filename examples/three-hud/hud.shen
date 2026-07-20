\\ examples/three-hud/hud.shen — proven game HUD, rendered as three.js textures
\\
\\ A game HUD is the environment witness was unknowingly designed for: the
\\ text lives in canvas textures on GPU quads, so there is no DOM fail-soft
\\ at all — an overflowing label is wrong pixels bleeding over a panel
\\ border, permanently. Every string woven into these textures is therefore
\\ one of:
\\
\\   Tier 1  proven-text   static chrome ("STATUS"), proven at load time
\\   Tier 2  prop-spec     locale strings: max-width bounds declared here,
\\                         enforced against every locale bundle by build.js
\\                         via enforce-props BEFORE any texture is rendered
\\   Tier 3  handled-text  flavor text: explicit ellipsis
\\
\\ Runtime-dynamic strings (player name, score) never pass through this
\\ file; build.js proves their worst case instead — see WORST_CASE there.
\\
\\ Font: the pinned measurement font (JetBrains Mono — see PINNED_FONT_FAMILY
\\ in boot.js). It is strictly monospace, and the generated page embeds the
\\ exact TTF that Node measured with, so browser pixels match proven widths.

(define hud-font
  Size -> (mk-font "JetBrains Mono" Size))

\\ --- Tier 2: locale bundle contract -----------------------------------------
\\ One (prop-spec KEY (max-width Font W)) per localized slot. build.js runs
\\ (enforce-props ...) for EVERY locale in locales.json against these specs;
\\ a translation that outgrows its slot fails the build with the key named.
\\ Bounds are the slot widths used by the views below — single source below
\\ each comment.

(prop-spec "score.label"   (max-width (hud-font 13) 110))
(prop-spec "health.label"  (max-width (hud-font 13) 110))
(prop-spec "stamina.label" (max-width (hud-font 13) 110))
(prop-spec "prompt"        (max-width (hud-font 15) 280))
(prop-spec "item.name"     (max-width (hud-font 18) 200))
(prop-spec "item.rarity"   (max-width (hud-font 12) 100))
(prop-spec "item.blurb"    (min-chars 1))

\\ --- Tier 1: static chrome proofs -------------------------------------------

(assert-fits "STATUS"    (hud-font 11) 236)
(assert-fits "TARGET"    (hud-font 11) 212)

\\ --- Views ------------------------------------------------------------------
\\ Locale strings arrive as arguments AFTER enforce-props has accepted the
\\ bundle, so they render as handled-text with `visible` — the Tier 2
\\ doctrine: the bound is checked at the component boundary, not the cell.

\\ Status panel (screen-space, top-left). 260 wide, 12 padding.
\\ Label column bound 110px; the right side is reserved for the bars and
\\ score digits that the runtime composites over this texture.
(define hud-status-panel
  ScoreL HealthL StaminaL ->
    [frame (mk-props9 260 0 "column" 10 12 "" "" 0 0)
      [[text-node (proven-text "STATUS" (hud-font 11) 236)]
       [text-node (handled-text ScoreL   (hud-font 13) 110 visible)]
       [text-node (handled-text HealthL  (hud-font 13) 110 visible)]
       [text-node (handled-text StaminaL (hud-font 13) 110 visible)]]])

\\ Prompt bar (screen-space, bottom-center). 320 wide, 20 padding => 280 slot.
(define hud-prompt-panel
  Prompt ->
    [frame (mk-props9 320 0 "column" 0 20 "" "" 0 0)
      [[text-node (handled-text Prompt (hud-font 15) 280 visible)]]])

\\ Item tooltip (world-space plane above the pedestal). 240 wide, 14 padding.
(define hud-tooltip-panel
  Name Rarity Blurb ->
    [frame (mk-props9 240 0 "column" 8 14 "" "" 0 0)
      [[text-node (proven-text "TARGET" (hud-font 11) 212)]
       [text-node (handled-text Name   (hud-font 18) 200 visible)]
       [text-node (handled-text Rarity (hud-font 12) 100 visible)]
       [text-node (handled-text Blurb  (hud-font 13) 212 ellipsis)]]])
