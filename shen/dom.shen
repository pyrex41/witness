\\ dom.shen — DOM renderer: walks computed layout, emits positioned DOM nodes
\\
\\ Takes a Textura computed layout (from solve-layout) and renders it
\\ to positioned absolutely-placed DOM elements.
\\
\\ NOTE: Loaded WITHOUT (tc +) — see witness.shen

\\ --- Style helper ---

(define px
  N -> (cn (str N) "px"))

\\ --- Check if layout node has text ---

(define has-text?
  Layout -> (string? (js.get Layout "text")))

\\ --- Render text content inside a positioned div ---

(define render-text
  El Layout ->
    (let Span (dom.create-element "span")
         _ (dom.set-text Span (js.get Layout "text"))
      (dom.append El Span)))

\\ --- Iterate a function over a list (side effects) ---

(define each
  _ [] -> true
  F [H | T] -> (let _ (F H) (each F T)))

\\ --- Render children recursively ---

(define render-children
  El Layout ->
    (let Children (shen-script.array->list (js.get Layout "children"))
      (each (/. Child (render-to-dom Child El)) Children)))

\\ --- Recursively walk computed layout, creating positioned DOM nodes ---

(define render-to-dom
  Layout Parent ->
    (let El (dom.create-element "div")
         _ (dom.set-style El
              (js.obj ["position" "absolute"
                       "left"     (px (js.get Layout "x"))
                       "top"      (px (js.get Layout "y"))
                       "width"    (px (js.get Layout "width"))
                       "height"   (px (js.get Layout "height"))]))
         _ (if (has-text? Layout)
               (render-text El Layout)
               (render-children El Layout))
      (dom.append Parent El)))

\\ --- Factory: returns a render function bound to a container ---

(define dom-renderer
  ContainerID ->
    (let Root (dom.get-by-id ContainerID)
      (/. Layout
        (let _ (dom.clear Root)
          (render-to-dom Layout Root)))))

\\ --- Type declarations for public API ---

(declare px [number --> string])
(declare has-text? [computed-layout --> boolean])
(declare render-text [dom-element --> [computed-layout --> dom-element]])
(declare each [[A --> B] --> [list A] --> boolean])
(declare render-children [dom-element --> [computed-layout --> boolean]])
(declare render-to-dom [computed-layout --> [dom-element --> dom-element]])
(declare dom-renderer [string --> [computed-layout --> dom-element]])
