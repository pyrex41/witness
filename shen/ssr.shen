\\ ssr.shen — Server-side renderer: walks computed layout, emits HTML string
\\
\\ Takes a Textura computed layout (from solve-layout) and produces
\\ an HTML string with absolutely-positioned divs. Mirrors dom.shen
\\ but outputs strings instead of DOM nodes.
\\
\\ NOTE: Loaded WITHOUT (tc +) — see witness.shen
\\
\\ IMPORTANT: Shen's reader chokes on angle brackets in string literals,
\\ so we build HTML tag delimiters via (n->string 60) and (n->string 62).

\\ --- Angle bracket helpers (avoids Shen reader issues) ---

(define lt -> (n->string 60))
(define gt -> (n->string 62))

\\ --- HTML tag builders ---

(define open-tag
  Tag -> (cn (lt) (cn Tag (gt))))

(define close-tag
  Tag -> (cn (lt) (cn "/" (cn Tag (gt)))))

(define open-tag-attrs
  Tag Attrs -> (cn (lt) (cn Tag (cn " " (cn Attrs (gt))))))

\\ --- Style helper ---

(define ssr-px
  N -> (cn (str N) "px"))

\\ --- Check if layout node has text ---

(define ssr-has-text?
  Layout -> (string? (js.get Layout "text")))

\\ --- Simple HTML escaping ---

(define html-escape
  "" -> ""
  S -> (let C (pos S 0)
            Rest (tlstr S)
         (cn (escape-char C) (html-escape Rest))))

(define escape-char
  C -> "&amp;"  where (= C (n->string 38))
  C -> "&lt;"   where (= C (n->string 60))
  C -> "&gt;"   where (= C (n->string 62))
  C -> "&quot;" where (= C (n->string 34))
  C -> C)

\\ --- Render text content as HTML ---

(define render-text-html
  Layout ->
    (cn (open-tag "span")
      (cn (html-escape (js.get Layout "text"))
        (close-tag "span"))))

\\ --- Render children recursively ---

(define render-children-html
  Layout ->
    (let Children (shen-script.array->list (js.get Layout "children"))
      (concat-strings (map (/. Child (render-node-html Child)) Children))))

\\ --- Concatenate a list of strings ---

(define concat-strings
  [] -> ""
  [S | Ss] -> (cn S (concat-strings Ss)))

\\ --- Recursively walk computed layout, producing HTML string ---

(define render-node-html
  Layout ->
    (let Style (cn "position:absolute;left:" (cn (ssr-px (js.get Layout "x"))
                (cn ";top:" (cn (ssr-px (js.get Layout "y"))
                (cn ";width:" (cn (ssr-px (js.get Layout "width"))
                (cn ";height:" (cn (ssr-px (js.get Layout "height")) ";"))))))))
         Attrs (cn "style=" (cn (n->string 34) (cn Style (n->string 34))))
         Content (if (ssr-has-text? Layout)
                     (render-text-html Layout)
                     (render-children-html Layout))
      (cn (open-tag-attrs "div" Attrs) (cn Content (close-tag "div")))))

\\ --- Wrap in full HTML document ---

(define render-html-doc
  Layout ->
    (let Doctype (cn (lt) (cn "!DOCTYPE html" (gt)))
         Meta (cn "charset=" (cn (n->string 34) (cn "utf-8" (n->string 34))))
         Head (cn (open-tag "head") (cn (open-tag-attrs "meta" Meta) (cn (open-tag "style") (cn "body{margin:0;position:relative;}" (close-tag "style")))))
         HeadClose (close-tag "head")
         Body (cn (open-tag "body") (cn (n->string 10) (cn (render-node-html Layout) (cn (n->string 10) (close-tag "body")))))
      (cn Doctype (cn (n->string 10)
        (cn (open-tag "html") (cn (n->string 10)
          (cn Head (cn HeadClose (cn (n->string 10)
            (cn Body (cn (n->string 10)
              (close-tag "html"))))))))))))

\\ --- Factory: returns a render function that produces HTML ---

(define ssr-renderer
  -> (/. Layout (render-html-doc Layout)))

\\ --- Type declarations for public API ---

(declare lt [--> string])
(declare gt [--> string])
(declare open-tag [string --> string])
(declare close-tag [string --> string])
(declare open-tag-attrs [string --> [string --> string]])
(declare ssr-px [number --> string])
(declare ssr-has-text? [computed-layout --> boolean])
(declare render-text-html [computed-layout --> string])
(declare html-escape [string --> string])
(declare escape-char [string --> string])
(declare concat-strings [[list string] --> string])
(declare render-node-html [computed-layout --> string])
(declare render-children-html [computed-layout --> string])
(declare render-html-doc [computed-layout --> string])
(declare ssr-renderer [--> [computed-layout --> string]])
