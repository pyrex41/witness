\\ errors.shen — Structured error reports with fix suggestions
\\
\\ Error reports are Shen lists with this shape:
\\   [error-report Code Domain Message Suggestions]
\\
\\ Each suggestion is: [fix Description effort Level confidence Score]

\\ --- Ceiling helper (pure Shen — works on any Shen implementation) ---
\\ Only used for positive pixel widths in error messages.
\\ Shen lacks floor/round/ceil built-ins, so we walk integers.

(define ceiling
  X -> (ceiling-walk X 0))

(define ceiling-walk
  X N -> N where (>= N X)
  X N -> (ceiling-walk X (+ N 1)))

\\ --- Construct a layout error report ---

(define make-layout-error
  Text Font MeasuredW AvailW ->
    [error-report
      "W0200"
      "layout-proof"
      (cn Text (cn " in " (cn Font (cn " = " (cn (str MeasuredW) (cn "px, container = " (cn (str AvailW) "px")))))))
      [[fix "Add truncate" effort "trivial" confidence 1.0]
       [fix (cn "Widen to " (cn (str (ceiling MeasuredW)) "px")) effort "trivial" confidence 0.95]
       [fix "Use smaller font" effort "small" confidence 0.9]]])

\\ --- Error report accessors ---

(define error-code
  [error-report Code _ _ _] -> Code)

(define error-message
  [error-report _ _ Message _] -> Message)

(define error-suggestions
  [error-report _ _ _ Suggestions] -> Suggestions)

\\ --- Format a single suggestion as a string ---

(define format-suggestion
  [fix Desc effort Level confidence Score] ->
    (cn "  - " (cn Desc (cn " [" (cn Level (cn ", confidence=" (cn (str Score) "]")))))))

\\ --- Format suggestion list ---

(define format-suggestions
  [] -> ""
  [S | Ss] -> (cn (format-suggestion S) (cn (n->string 10) (format-suggestions Ss))))

\\ --- Format full error report as readable string ---

(define format-error
  Report ->
    (cn "[" (cn (error-code Report) (cn "] " (cn (error-message Report)
      (cn (n->string 10) (cn "Suggestions:" (cn (n->string 10)
        (format-suggestions (error-suggestions Report))))))))))

\\ --- Check text: returns [ok] or an error report ---

(define check-text
  Text Font MaxW ->
    (if (fits? Text Font MaxW)
        [ok]
        (make-layout-error Text Font (measure Text Font) MaxW)))

\\ --- Type declarations ---

(declare ceiling [number --> number])
(declare make-layout-error [string --> [string --> [number --> [number --> [list A]]]]])
(declare error-code [[list A] --> string])
(declare error-message [[list A] --> string])
(declare error-suggestions [[list A] --> [list [list A]]])
(declare format-suggestion [[list A] --> string])
(declare format-suggestions [[list [list A]] --> string])
(declare format-error [[list A] --> string])
(declare check-text [string --> [string --> [number --> [list A]]]])
