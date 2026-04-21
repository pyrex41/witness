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

\\ --- Overflow CSS fragment for text nodes ---
\\ Read the `overflow` tag propagated from the input tree by boot.js.
\\ For ellipsis/clip we need a single-line container that truncates at MaxW.
\\ Visible (or absent) means no clipping — empty CSS.

(define ssr-overflow-css
  Layout -> (ssr-overflow-from (js.get Layout "overflow")))

(define ssr-overflow-from
  "ellipsis" -> "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
  "clip"     -> "overflow:hidden;white-space:nowrap;"
  _          -> "")

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
\\ Pin font + line-height on the span so the browser renders at exactly
\\ the size Textura measured with — preserving the layout invariant.
\\
\\ Two data-witness-* attrs mark every text cell so a geometry-truth test
\\ can compare the browser's rendered width against the prover's claim:
\\
\\   data-witness-text="<predicted-px>"
\\       The width Pretext/Yoga predicted for this text cell. The browser's
\\       actual span width must equal this (±1px) or the prover is wrong
\\       about what the browser will render.
\\
\\   data-witness-overflow="visible|ellipsis|clip"
\\       For visible cells the rendered text must fit the parent cell
\\       (scrollWidth ≤ parent clientWidth). For ellipsis/clip the browser
\\       is expected to truncate via CSS, so overflow is allowed.

(define ssr-text-span-style
  Layout ->
    (let Family (ssr-str-field Layout "fontFamily")
         Size   (js.get Layout "fontSize")
         LH     (js.get Layout "lineHeight")
         LHPx   (if (js.undefined? LH) "20px" (cn (str LH) "px"))
         FamCSS (if (= Family "") "" (cn "font-family:" (cn Family ";")))
         SizeCSS (if (js.undefined? Size) "" (cn "font-size:" (cn (str Size) "px;")))
      (cn FamCSS (cn SizeCSS (cn "line-height:" (cn LHPx ";margin:0;padding:0;"))))))

(define ssr-text-witness-attrs
  Layout ->
    (let Ov (ssr-str-field Layout "overflow")
         OvTag (if (= Ov "") "visible" Ov)
         W (js.get Layout "width")
         WStr (if (js.undefined? W) "0" (str W))
         Q (n->string 34)
      (cn "data-witness-text=" (cn Q (cn WStr (cn Q
        (cn " data-witness-overflow=" (cn Q (cn OvTag Q)))))))))

(define render-text-html
  Layout ->
    (cn (open-tag-attrs "span"
          (cn (ssr-text-witness-attrs Layout)
            (cn " style=" (cn (n->string 34)
              (cn (ssr-text-span-style Layout) (n->string 34))))))
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

\\ --- Read optional JS string field (undefined → "") ---

(define ssr-str-field
  Layout Key ->
    (let V (js.get Layout Key)
      (if (js.undefined? V) "" (if (string? V) V ""))))

\\ --- Class attribute fragment: empty when no className ---

(define ssr-class-attr
  Layout ->
    (let C (ssr-str-field Layout "className")
      (if (= C "") "" (cn "class=" (cn (n->string 34) (cn C (cn (n->string 34) " ")))))))

\\ --- href attribute fragment: empty when no href ---

(define ssr-href-attr
  Layout ->
    (let H (ssr-str-field Layout "href")
      (if (= H "") "" (cn "href=" (cn (n->string 34) (cn H (cn (n->string 34) " ")))))))

\\ --- HTML tag for this node (default: div) ---

(define ssr-tag
  Layout ->
    (let T (ssr-str-field Layout "htmlTag")
      (if (= T "") "div" T)))

\\ --- Recursively walk computed layout, producing HTML string ---

(define render-node-html
  Layout ->
    (let Tag (ssr-tag Layout)
         BaseStyle (cn "position:absolute;left:" (cn (ssr-px (js.get Layout "x"))
                    (cn ";top:" (cn (ssr-px (js.get Layout "y"))
                    (cn ";width:" (cn (ssr-px (js.get Layout "width"))
                    (cn ";height:" (cn (ssr-px (js.get Layout "height")) ";margin:0;padding:0;box-sizing:border-box;font:inherit;"))))))))
         WrapperLH (if (ssr-has-text? Layout)
                       (let LH (js.get Layout "lineHeight")
                         (if (js.undefined? LH) "" (cn "line-height:" (cn (str LH) "px;"))))
                       "")
         Style (cn BaseStyle (cn WrapperLH (if (ssr-has-text? Layout) (ssr-overflow-css Layout) "")))
         Attrs (cn (ssr-class-attr Layout) (cn (ssr-href-attr Layout) (cn "style=" (cn (n->string 34) (cn Style (n->string 34))))))
         Content (if (ssr-has-text? Layout)
                     (render-text-html Layout)
                     (render-children-html Layout))
      (cn (open-tag-attrs Tag Attrs) (cn Content (close-tag Tag)))))

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
(declare ssr-overflow-css [computed-layout --> string])
(declare ssr-overflow-from [string --> string])
(declare ssr-text-witness-attrs [computed-layout --> string])
(declare render-text-html [computed-layout --> string])
(declare html-escape [string --> string])
(declare escape-char [string --> string])
(declare concat-strings [[list string] --> string])
(declare render-node-html [computed-layout --> string])
(declare render-children-html [computed-layout --> string])
(declare render-html-doc [computed-layout --> string])
(declare ssr-renderer [--> [computed-layout --> string]])
