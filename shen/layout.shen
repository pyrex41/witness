\\ layout.shen — Node types and Textura tree bridge
\\
\\ Defines the layout node types (frame, text-node, spacer)
\\ and converts them to Textura input trees for layout computation.
\\
\\ NOTE: Loaded WITHOUT (tc +) — see witness.shen

\\ --- Frame props: a 9-element list of layout properties ---

(define mk-props
  Width Height Direction Gap Padding Justify Align Grow Shrink ->
    [Width Height Direction Gap Padding Justify Align Grow Shrink])

(define get-width    [W | _] -> W)
(define get-height   [_ H | _] -> H)
(define get-direction [_ _ D | _] -> D)
(define get-gap      [_ _ _ G | _] -> G)
(define get-padding  [_ _ _ _ P | _] -> P)
(define get-justify  [_ _ _ _ _ J | _] -> J)
(define get-align    [_ _ _ _ _ _ A | _] -> A)
(define get-grow     [_ _ _ _ _ _ _ G | _] -> G)
(define get-shrink   [_ _ _ _ _ _ _ _ S | _] -> S)

\\ --- Default props ---

(define default-props -> (mk-props 0 0 "column" 0 0 "" "" 0 0))

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

(declare mk-props [number --> [number --> [string --> [number --> [number --> [string --> [string --> [number --> [number --> frame-props]]]]]]]]])
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
(declare to-textura [node --> textura-tree])
(declare solve-layout [node --> [number --> [number --> computed-layout]]])
