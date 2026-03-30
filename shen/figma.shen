\\ figma.shen — Structural verification of Figma designs against code
\\
\\ Parses Figma JSON exports and compares node positions against
\\ computed layout trees to detect structural drift.
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

\\ --- Figma JSON → position list ---
\\ Figma nodes have absoluteBoundingBox with x, y, width, height.
\\ We extract a flat list of [position X Y W H] tuples.

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
      [position (js.get Box "x") (js.get Box "y")
                (js.get Box "width") (js.get Box "height")]))

\\ --- Get root dimensions from Figma spec ---

(define get-figma-width
  Spec -> (js.get (js.get Spec "absoluteBoundingBox") "width"))

(define get-figma-height
  Spec -> (js.get (js.get Spec "absoluteBoundingBox") "height"))

\\ --- Layout tree → position list ---
\\ Computed layout nodes have .x, .y, .width, .height, .children

(define layout->positions
  Layout ->
    (let Pos [position (js.get Layout "x") (js.get Layout "y")
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

(define diff-positions
  [] [] _ -> []
  [F | Fs] [C | Cs] Tol ->
    (let Diff (position-diff F C Tol)
      (if (= Diff [])
          (diff-positions Fs Cs Tol)
          [Diff | (diff-positions Fs Cs Tol)]))
  Fs Cs _ -> [[count-mismatch (length Fs) (length Cs)]])

(define position-diff
  [position Fx Fy Fw Fh] [position Cx Cy Cw Ch] Tol ->
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
(declare position-diff [A --> [A --> [number --> [list A]]]])
(declare verify-figma [string --> [A --> [number --> [list A]]]])
