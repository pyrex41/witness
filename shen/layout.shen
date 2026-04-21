\\ layout.shen — Node types and Textura tree bridge
\\
\\ Defines the layout node types (frame, text-node, spacer)
\\ and converts them to Textura input trees for layout computation.
\\
\\ NOTE: Loaded WITHOUT (tc +) — see witness.shen

\\ --- Frame props: a 14-element list of layout properties ---
\\ [Width Height Direction Gap Padding Justify Align Grow Shrink
\\  Margin FlexWrap MinWidth MaxWidth MinHeight]

(define mk-props
  Width Height Direction Gap Padding Justify Align Grow Shrink
  Margin FlexWrap MinWidth MaxWidth MinHeight ->
    [Width Height Direction Gap Padding Justify Align Grow Shrink
     Margin FlexWrap MinWidth MaxWidth MinHeight])

\\ Convenience constructor with 9 args (backwards compatible)
(define mk-props9
  Width Height Direction Gap Padding Justify Align Grow Shrink ->
    (mk-props Width Height Direction Gap Padding Justify Align Grow Shrink
              0 "" 0 0 0))

(define get-width    [W | _] -> W)
(define get-height   [_ H | _] -> H)
(define get-direction [_ _ D | _] -> D)
(define get-gap      [_ _ _ G | _] -> G)
(define get-padding  [_ _ _ _ P | _] -> P)
(define get-justify  [_ _ _ _ _ J | _] -> J)
(define get-align    [_ _ _ _ _ _ A | _] -> A)
(define get-grow     [_ _ _ _ _ _ _ G | _] -> G)
(define get-shrink   [_ _ _ _ _ _ _ _ S | _] -> S)
(define get-margin   [_ _ _ _ _ _ _ _ _ M | _] -> M)
(define get-flex-wrap [_ _ _ _ _ _ _ _ _ _ W | _] -> W)
(define get-min-width [_ _ _ _ _ _ _ _ _ _ _ Mn | _] -> Mn)
(define get-max-width [_ _ _ _ _ _ _ _ _ _ _ _ Mx | _] -> Mx)
(define get-min-height [_ _ _ _ _ _ _ _ _ _ _ _ _ Mh | _] -> Mh)

\\ --- Default props ---

(define default-props -> (mk-props 0 0 "column" 0 0 "" "" 0 0 0 "" 0 0 0))

\\ --- Node types ---

(datatype node-types
  Props : frame-props; Children : (list node);
  ________________________________________________
  [frame Props Children] : node;

  T : safe-text;
  __________________
  [text-node T] : node;

  W : number; H : number;
  ____________________________
  [spacer W H] : node;)

\\ --- Overflow strategy → CSS value string ---
\\ The renderer emits `overflow:<value>;text-overflow:<...>;white-space:<...>`
\\ based on this tag. Kept as CSS-compatible strings so renderers don't need
\\ to reinterpret the tag.

(define overflow->css
  ellipsis -> "ellipsis"
  clip     -> "clip"
  visible  -> "visible"
  _        -> "visible")

\\ --- Clip width for handled-text ---
\\ For ellipsis/clip the renderer must know the displayed width so the CSS
\\ truncation actually cuts at the container bound. For visible we pass 0,
\\ meaning "don't override the Yoga-computed width."

(define clip-width
  visible _ -> 0
  _       MaxW -> MaxW)

\\ --- Yoga width for handled-text ---
\\ Mirrors clip-width: for visible we let Yoga measure intrinsically (0 =
\\ unset); for ellipsis/clip we cap Yoga's cell at MaxW so the CSS
\\ truncation works without distorting sibling flex layout.

(define yoga-width-for-overflow
  visible _    -> 0
  _       MaxW -> MaxW)

\\ --- Convert Witness node tree to Textura input tree ---
\\
\\ Text measurement note: we always pass 999999 as the Yoga layout width for
\\ text nodes. This keeps Pretext from wrapping the text into multiple lines
\\ (which would shift siblings and break Figma structural verification).
\\ Visual clipping for ellipsis/clip is done by the renderer via CSS, using
\\ the clip-width propagated alongside the `overflow` tag.

(define to-textura
  [frame Props Children] ->
    (textura-obj
      (get-width Props) (get-height Props)
      (get-direction Props) (get-gap Props)
      (get-padding Props)
      (get-justify Props) (get-align Props)
      (get-grow Props) (get-shrink Props)
      (get-margin Props) (get-flex-wrap Props)
      (get-min-width Props) (get-max-width Props)
      (get-min-height Props)
      (map (/. C (to-textura C)) Children))

  \\ proven-text: intrinsic layout, proof-only bound.
  \\
  \\ MaxW is a proof obligation — it says "I claim measure(Text,Font) <= MaxW".
  \\ It is NOT the rendered cell width. Rendering uses intrinsic width (Yoga
  \\ measures via Pretext), so a tight proof bound doesn't produce visual
  \\ whitespace. Declaring (proven-text "reuben" (mono 14) 72) gets you a
  \\ 46px cell, not a 72px one — the 72 is "at most," and the actual layout
  \\ stays tight.
  \\
  \\ This was the original bug the screenshot exposed: setting Yoga width
  \\ to MaxW made every cell render at its declared bound, so any slack
  \\ turned into dead whitespace between flex siblings.
  \\
  \\ Render-time fit check is kept: static literals also fail at load via
  \\ assert-fits, dynamic prop values fail here with the same message format.
  [text-node [proven-text Text Font MaxW]] ->
    (if (fits? Text Font MaxW)
        (textura-text Text Font 0 0 0 "visible")
        (simple-error
          (cn "Layout overflow: '" (cn Text
            (cn "' in " (cn Font
              (cn " = " (cn (str (measure Text Font))
                (cn "px, container = " (cn (str MaxW) "px"))))))))))

  \\ handled-text: escape hatch with explicit overflow strategy.
  \\
  \\ visible  -> intrinsic width; overflow is the author's responsibility.
  \\ ellipsis -> cap Yoga width at MaxW so siblings pack correctly; CSS
  \\             text-overflow does the visual cut at MaxW.
  \\ clip     -> same as ellipsis, different CSS strategy.
  [text-node [handled-text Text Font MaxW Overflow]] ->
    (textura-text Text Font 0
      (yoga-width-for-overflow Overflow MaxW)
      (clip-width Overflow MaxW)
      (overflow->css Overflow))

  [with-class Class Inner] ->
    (js.set-prop! (to-textura Inner) "className" Class)

  [with-tag Tag Inner] ->
    (js.set-prop! (to-textura Inner) "htmlTag" Tag)

  [with-href Url Inner] ->
    (js.set-prop! (to-textura Inner) "href" Url)

  [spacer W H] ->
    (textura-box W H))

\\ --- Run the layout solver ---

(define solve-layout
  Root AvailW AvailH ->
    (textura.layout (to-textura Root)))

\\ --- Type declarations for public API ---

(declare mk-props [number --> [number --> [string --> [number --> [number --> [string --> [string --> [number --> [number --> [number --> [string --> [number --> [number --> [number --> frame-props]]]]]]]]]]]]]])
(declare mk-props9 [number --> [number --> [string --> [number --> [number --> [string --> [string --> [number --> [number --> frame-props]]]]]]]]])
(declare default-props [--> frame-props])
(declare get-width [frame-props --> number])
(declare get-height [frame-props --> number])
(declare get-direction [frame-props --> string])
(declare get-gap [frame-props --> number])
(declare get-padding [frame-props --> number])
(declare get-justify [frame-props --> string])
(declare get-align [frame-props --> string])
(declare get-grow [frame-props --> number])
(declare get-shrink [frame-props --> number])
(declare get-margin [frame-props --> number])
(declare get-flex-wrap [frame-props --> string])
(declare get-min-width [frame-props --> number])
(declare get-max-width [frame-props --> number])
(declare get-min-height [frame-props --> number])
(declare overflow->css [overflow --> string])
(declare clip-width [overflow --> [number --> number]])
(declare yoga-width-for-overflow [overflow --> [number --> number]])
(declare to-textura [node --> textura-tree])
(declare solve-layout [node --> [number --> [number --> computed-layout]]])
