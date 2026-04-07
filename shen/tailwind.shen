\\ tailwind.shen — Tailwind CSS class parser for Textura props
\\
\\ Parses Tailwind-style utility classes into layout property pairs,
\\ then converts them into frame-props for the Witness layout engine.
\\
\\ NOTE: Loaded WITHOUT (tc +) — see witness.shen

\\ --- Size scale: Tailwind spacing units to pixels ---

(define tw-scale
  "0" -> 0    "1" -> 4    "2" -> 8    "3" -> 12
  "4" -> 16   "5" -> 20   "6" -> 24   "8" -> 32
  "10" -> 40  "12" -> 48  "16" -> 64  "20" -> 80
  "24" -> 96  "32" -> 128 "40" -> 160 "48" -> 192
  "56" -> 224 "64" -> 256 "72" -> 288 "80" -> 320
  "96" -> 384
  N -> (simple-error (cn "Unknown Tailwind size: " N)))

\\ --- String helpers ---

\\ Get substring from position Start to end
(define substr-from
  S Start -> (substr-from-acc S Start 0 ""))

(define substr-from-acc
  "" _ _ Acc -> Acc
  S Start Pos Acc ->
    (if (>= Pos Start)
        (substr-from-acc (tlstr S) Start (+ Pos 1) (cn Acc (pos S 0)))
        (substr-from-acc (tlstr S) Start (+ Pos 1) Acc)))

\\ String length
(define slen
  "" -> 0
  S -> (+ 1 (slen (tlstr S))))

\\ Check if string starts with a prefix
(define starts-with?
  "" _ -> true
  Prefix S -> (if (= S "")
                  false
                  (if (= (pos Prefix 0) (pos S 0))
                      (starts-with? (tlstr Prefix) (tlstr S))
                      false)))

\\ Strip a known prefix from a string (caller ensures it starts with prefix)
(define strip-prefix
  "" S -> S
  Prefix S -> (strip-prefix (tlstr Prefix) (tlstr S)))

\\ --- Parse a single Tailwind class string to a property pair ---

(define parse-tw-class
  "flex" -> [direction "row"]
  "flex-col" -> [direction "column"]
  "flex-row" -> [direction "row"]
  "flex-wrap" -> [flex-wrap "wrap"]
  "flex-nowrap" -> [flex-wrap "nowrap"]
  "items-center" -> [align "center"]
  "items-start" -> [align "flex-start"]
  "items-end" -> [align "flex-end"]
  "justify-between" -> [justify "space-between"]
  "justify-center" -> [justify "center"]
  "justify-start" -> [justify "flex-start"]
  "justify-end" -> [justify "flex-end"]
  "grow" -> [flex-grow 1]
  "shrink" -> [flex-shrink 1]
  "truncate" -> [overflow ellipsis]
  "text-xs" -> [font-size 12]
  "text-sm" -> [font-size 14]
  "text-base" -> [font-size 16]
  "text-lg" -> [font-size 18]
  "font-medium" -> [font-weight 500]
  "font-bold" -> [font-weight 700]
  "rounded-lg" -> [border-radius 8]
  Class -> (parse-tw-prefixed Class))

\\ Parse classes with prefix-size pattern (w-4, h-2, p-8, m-4, etc.)

(define parse-tw-prefixed
  Class ->
    (if (starts-with? "min-w-" Class)
        [min-width (tw-scale (strip-prefix "min-w-" Class))]
    (if (starts-with? "max-w-" Class)
        [max-width (tw-scale (strip-prefix "max-w-" Class))]
    (if (starts-with? "min-h-" Class)
        [min-height (tw-scale (strip-prefix "min-h-" Class))]
    (if (starts-with? "w-" Class)
        [width (tw-scale (strip-prefix "w-" Class))]
    (if (starts-with? "h-" Class)
        [height (tw-scale (strip-prefix "h-" Class))]
    (if (starts-with? "m-" Class)
        [margin (tw-scale (strip-prefix "m-" Class))]
    (if (starts-with? "p-" Class)
        [padding (tw-scale (strip-prefix "p-" Class))]
    (if (starts-with? "px-" Class)
        [padding-x (tw-scale (strip-prefix "px-" Class))]
    (if (starts-with? "py-" Class)
        [padding-y (tw-scale (strip-prefix "py-" Class))]
    (if (starts-with? "gap-" Class)
        [gap (tw-scale (strip-prefix "gap-" Class))]
        [unknown Class])))))))))))

\\ --- Parse a list of class strings to a list of property pairs ---

(define parse-tw-classes
  [] -> []
  [C | Cs] -> [(parse-tw-class C) | (parse-tw-classes Cs)])

\\ --- Merge parsed properties into frame-props (mk-props) ---
\\ 14 fields: W H D G P J A Gr Sh M FW MnW MxW MnH

(define tw-to-props
  Props -> (tw-merge Props 0 0 "column" 0 0 "" "" 0 0 0 "" 0 0 0))

(define tw-merge
  [] W H D G P J A Gr Sh M FW MnW MxW MnH -> (mk-props W H D G P J A Gr Sh M FW MnW MxW MnH)
  [[width V] | Rest] _ H D G P J A Gr Sh M FW MnW MxW MnH -> (tw-merge Rest V H D G P J A Gr Sh M FW MnW MxW MnH)
  [[height V] | Rest] W _ D G P J A Gr Sh M FW MnW MxW MnH -> (tw-merge Rest W V D G P J A Gr Sh M FW MnW MxW MnH)
  [[direction V] | Rest] W H _ G P J A Gr Sh M FW MnW MxW MnH -> (tw-merge Rest W H V G P J A Gr Sh M FW MnW MxW MnH)
  [[gap V] | Rest] W H D _ P J A Gr Sh M FW MnW MxW MnH -> (tw-merge Rest W H D V P J A Gr Sh M FW MnW MxW MnH)
  [[padding V] | Rest] W H D G _ J A Gr Sh M FW MnW MxW MnH -> (tw-merge Rest W H D G V J A Gr Sh M FW MnW MxW MnH)
  [[justify V] | Rest] W H D G P _ A Gr Sh M FW MnW MxW MnH -> (tw-merge Rest W H D G P V A Gr Sh M FW MnW MxW MnH)
  [[align V] | Rest] W H D G P J _ Gr Sh M FW MnW MxW MnH -> (tw-merge Rest W H D G P J V Gr Sh M FW MnW MxW MnH)
  [[flex-grow V] | Rest] W H D G P J A _ Sh M FW MnW MxW MnH -> (tw-merge Rest W H D G P J A V Sh M FW MnW MxW MnH)
  [[flex-shrink V] | Rest] W H D G P J A Gr _ M FW MnW MxW MnH -> (tw-merge Rest W H D G P J A Gr V M FW MnW MxW MnH)
  [[margin V] | Rest] W H D G P J A Gr Sh _ FW MnW MxW MnH -> (tw-merge Rest W H D G P J A Gr Sh V FW MnW MxW MnH)
  [[flex-wrap V] | Rest] W H D G P J A Gr Sh M _ MnW MxW MnH -> (tw-merge Rest W H D G P J A Gr Sh M V MnW MxW MnH)
  [[min-width V] | Rest] W H D G P J A Gr Sh M FW _ MxW MnH -> (tw-merge Rest W H D G P J A Gr Sh M FW V MxW MnH)
  [[max-width V] | Rest] W H D G P J A Gr Sh M FW MnW _ MnH -> (tw-merge Rest W H D G P J A Gr Sh M FW MnW V MnH)
  [[min-height V] | Rest] W H D G P J A Gr Sh M FW MnW MxW _ -> (tw-merge Rest W H D G P J A Gr Sh M FW MnW MxW V)
  [[_ _] | Rest] W H D G P J A Gr Sh M FW MnW MxW MnH -> (tw-merge Rest W H D G P J A Gr Sh M FW MnW MxW MnH))

\\ --- The tw function: shorthand for creating frame nodes ---
\\ (tw ["flex" "gap-4" "p-8"] Children) => [frame Props Children]

(define tw
  Classes Children ->
    [frame (tw-to-props (parse-tw-classes Classes)) Children])

\\ --- Type declarations ---

(declare parse-tw-class [string --> [list A]])
(declare parse-tw-classes [[list string] --> [list [list A]]])
(declare tw-to-props [[list [list A]] --> frame-props])
(declare tw [[list string] --> [[list node] --> node]])
