\\ figma.shen — Structural verification of Figma designs against code
\\
\\ Parses Figma JSON exports and compares node positions against
\\ computed layout trees to detect structural drift.
\\ Supports name-based matching (preferred) with positional fallback.
\\
\\ NOTE: Loaded WITHOUT (tc +) — see witness.shen

\\ --- File reading helpers ---

(define read-file-string
  Path -> (let Stream (open Path in)
            (read-all-bytes Stream "")))

(define read-all-bytes
  Stream Acc -> (let Byte (read-byte Stream)
                  (if (= Byte -1)
                      (do (close Stream) Acc)
                      (read-all-bytes Stream (cn Acc (n->string Byte))))))

\\ --- Absolute value ---

(define abs
  X -> (if (< X 0) (- 0 X) X))

\\ --- Figma JSON → named position list ---
\\ Figma nodes have absoluteBoundingBox with x, y, width, height.
\\ We extract a flat list of [named-position Name X Y W H] tuples.

(define figma-json->positions
  Spec ->
    (let Nodes (extract-figma-nodes Spec)
      (map (/. N (figma-node-position N)) Nodes)))

(define extract-figma-nodes
  Node ->
    (let Children (js.get Node "children")
      (if (js.undefined? Children)
          [Node]
          (let ChildList (shen-script.array->list Children)
            [Node | (mapcat (/. C (extract-figma-nodes C)) ChildList)]))))

(define figma-node-position
  Node ->
    (let Box (js.get Node "absoluteBoundingBox")
         Name (js.get Node "name")
         NodeName (if (js.undefined? Name) "" Name)
      [named-position NodeName
        (js.get Box "x") (js.get Box "y")
        (js.get Box "width") (js.get Box "height")]))

\\ --- Get root dimensions from Figma spec ---

(define get-figma-width
  Spec -> (js.get (js.get Spec "absoluteBoundingBox") "width"))

(define get-figma-height
  Spec -> (js.get (js.get Spec "absoluteBoundingBox") "height"))

\\ --- Layout tree → named position list ---
\\ Computed layout nodes have .x, .y, .width, .height, .children

(define layout->positions
  Layout ->
    (let Pos [named-position ""
                (js.get Layout "x") (js.get Layout "y")
                (js.get Layout "width") (js.get Layout "height")]
         Children (js.get Layout "children")
         ChildList (if (js.undefined? Children)
                       []
                       (shen-script.array->list Children))
         ChildPositions (mapcat (/. C (layout->positions C)) ChildList)
      [Pos | ChildPositions]))

\\ --- filter: keep elements matching predicate ---

(define filter
  _ [] -> []
  F [X | Xs] -> (if (F X) [X | (filter F Xs)] (filter F Xs)))

\\ --- mapcat: map then concatenate ---

(define mapcat
  _ [] -> []
  F [X | Xs] -> (append (F X) (mapcat F Xs)))

\\ --- Position comparison ---
\\ Matches by name when both positions have non-empty names,
\\ falls back to positional (index-based) comparison otherwise.

\\ diff-positions:
\\ Uses name-based matching for named-position format,
\\ falls back to positional for legacy [position X Y W H] format.

(define diff-positions
  [] [] _ -> []
  Figma Code Tol ->
    (if (is-named-format? Figma)
        (diff-named Figma Code Tol)
        (diff-positional Figma Code Tol)))

(define is-named-format?
  [[named-position | _] | _] -> true
  _ -> false)

(define diff-named
  Figma Code Tol ->
    (let Named (match-by-name Figma Code Tol)
         UnmatchedF (get-unmatched-figma Figma Code)
         UnmatchedC (get-unmatched-code Figma Code)
         Positional (diff-positional UnmatchedF UnmatchedC Tol)
      (append Named Positional)))

\\ --- Name-based matching ---

(define match-by-name
  [] _ _ -> []
  [[named-position "" _ _ _ _] | Rest] Code Tol -> (match-by-name Rest Code Tol)
  [[named-position Name Fx Fy Fw Fh] | Rest] Code Tol ->
    (let Match (find-by-name Name Code)
      (if (= Match [])
          (match-by-name Rest Code Tol)
          (let Diff (position-diff-values Fx Fy Fw Fh
                      (get-pos-x Match) (get-pos-y Match)
                      (get-pos-w Match) (get-pos-h Match) Tol)
            (if (= Diff [])
                (match-by-name Rest Code Tol)
                [[name-diff Name Diff] | (match-by-name Rest Code Tol)])))))

(define find-by-name
  _ [] -> []
  Name [[named-position Name X Y W H] | _] -> [named-position Name X Y W H]
  Name [_ | Rest] -> (find-by-name Name Rest))

\\ --- Get unmatched positions (those without name or without a name match) ---

(define get-unmatched-figma
  [] _ -> []
  [[named-position "" X Y W H] | Rest] Code ->
    [[named-position "" X Y W H] | (get-unmatched-figma Rest Code)]
  [[named-position Name X Y W H] | Rest] Code ->
    (if (has-name? Name Code)
        (get-unmatched-figma Rest Code)
        [[named-position Name X Y W H] | (get-unmatched-figma Rest Code)])
  [P | Rest] Code -> [P | (get-unmatched-figma Rest Code)])

(define get-unmatched-code
  _ [] -> []
  Figma [[named-position "" X Y W H] | Rest] ->
    [[named-position "" X Y W H] | (get-unmatched-code Figma Rest)]
  Figma [[named-position Name X Y W H] | Rest] ->
    (if (has-figma-name? Name Figma)
        (get-unmatched-code Figma Rest)
        [[named-position Name X Y W H] | (get-unmatched-code Figma Rest)])
  Figma [P | Rest] -> [P | (get-unmatched-code Figma Rest)])

(define has-name?
  _ [] -> false
  Name [[named-position Name _ _ _ _] | _] -> true
  Name [_ | Rest] -> (has-name? Name Rest))

(define has-figma-name?
  _ [] -> false
  Name [[named-position Name _ _ _ _] | _] -> true
  Name [_ | Rest] -> (has-figma-name? Name Rest))

\\ --- Position accessors for named-position ---

(define get-pos-x [named-position _ X _ _ _] -> X)
(define get-pos-y [named-position _ _ Y _ _] -> Y)
(define get-pos-w [named-position _ _ _ W _] -> W)
(define get-pos-h [named-position _ _ _ _ H] -> H)

\\ --- Positional (index-based) fallback comparison ---

(define diff-positional
  [] [] _ -> []
  [F | Fs] [C | Cs] Tol ->
    (let Diff (position-diff F C Tol)
      (if (= Diff [])
          (diff-positional Fs Cs Tol)
          [Diff | (diff-positional Fs Cs Tol)]))
  Fs Cs _ -> (if (and (= Fs []) (= Cs []))
                 []
                 [[count-mismatch (length Fs) (length Cs)]]))

\\ --- Compare two position tuples field by field ---

(define position-diff
  [named-position _ Fx Fy Fw Fh] [named-position _ Cx Cy Cw Ch] Tol ->
    (position-diff-values Fx Fy Fw Fh Cx Cy Cw Ch Tol)
  \\ Legacy: also handle bare [position X Y W H] format
  [position Fx Fy Fw Fh] [position Cx Cy Cw Ch] Tol ->
    (position-diff-values Fx Fy Fw Fh Cx Cy Cw Ch Tol))

(define position-diff-values
  Fx Fy Fw Fh Cx Cy Cw Ch Tol ->
    (filter (/. D (not (= D [])))
      [(if (> (abs (- Fx Cx)) Tol) [x-diff Fx Cx] [])
       (if (> (abs (- Fy Cy)) Tol) [y-diff Fy Cy] [])
       (if (> (abs (- Fw Cw)) Tol) [w-diff Fw Cw] [])
       (if (> (abs (- Fh Ch)) Tol) [h-diff Fh Ch] [])]))

\\ --- Main entry point ---

(define verify-figma
  FigmaJsonPath CodeNode Tolerance ->
    (let Spec (json.parse (read-file-string FigmaJsonPath))
         FigmaTree (figma-json->positions Spec)
         CodeLayout (solve-layout CodeNode
                      (get-figma-width Spec) (get-figma-height Spec))
         CodeTree (layout->positions CodeLayout)
         Diffs (diff-positions FigmaTree CodeTree Tolerance)
      (if (= Diffs [])
          [pass "All nodes within tolerance"]
          [fail Diffs])))

\\ --- Type declarations for public API ---

(declare filter [[A --> boolean] --> [[list A] --> [list A]]])
(declare read-file-string [string --> string])
(declare abs [number --> number])
(declare figma-json->positions [A --> [list [list A]]])
(declare extract-figma-nodes [A --> [list A]])
(declare figma-node-position [A --> [list A]])
(declare get-figma-width [A --> number])
(declare get-figma-height [A --> number])
(declare layout->positions [A --> [list [list A]]])
(declare mapcat [[A --> [list B]] --> [[list A] --> [list B]]])
(declare diff-positions [[list A] --> [[list A] --> [number --> [list A]]]])
(declare diff-positional [[list A] --> [[list A] --> [number --> [list A]]]])
(declare match-by-name [[list A] --> [[list A] --> [number --> [list A]]]])
(declare find-by-name [string --> [[list A] --> [list A]]])
(declare position-diff [A --> [A --> [number --> [list A]]]])
(declare position-diff-values [number --> [number --> [number --> [number --> [number --> [number --> [number --> [number --> [number --> [list A]]]]]]]]]])
(declare verify-figma [string --> [A --> [number --> [list A]]]])
(declare get-pos-x [[list A] --> number])
(declare get-pos-y [[list A] --> number])
(declare get-pos-w [[list A] --> number])
(declare get-pos-h [[list A] --> number])
