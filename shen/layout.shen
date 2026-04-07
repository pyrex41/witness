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

\\ --- Convert Witness node tree to Textura input tree ---

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

  [text-node [proven-text Text Font MaxW]] ->
    (textura-text Text Font 20 MaxW)

  [text-node [handled-text Text Font _]] ->
    (textura-text Text Font 20 999999)

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
(declare to-textura [node --> textura-tree])
(declare solve-layout [node --> [number --> [number --> computed-layout]]])
