\\ examples/price-column.shen — Tier 2 flagship
\\
\\ A price column that provably never overflows, for ANY price.
\\
\\ Run: witness dev examples/price-column.shen      (Tier 2 load-time proof)
\\      witness render examples/price-column.shen   (SSR with solved layout)
\\
\\ The whole point of Tier 2: the values below ("0.00", "9,999,999.99", ...)
\\ are dynamic — they could come from an API, a database, a user's cart.
\\ We never measure them. Instead we prove a statement about the *alphabet*:
\\ any string of at most 12 characters drawn from {0-9 , .} fits 110px in
\\ this monospace font. Since monospace digits all share one advance, the
\\ worst case (12 x 8.43px = 101.2px) is exact, and 101.2 <= 110 holds for
\\ every price the column can ever display — up to "9,999,999.99".
\\
\\ This single assertion discharges the proof for the entire column:

(assert-bounded-fits (price-chars) 12 (mk-font "monospace" 14) 110)

\\ price-cell takes a *dynamic* price string. bounded-text is the Tier-2
\\ cell: unlike proven-text it accepts a runtime value, because the proof
\\ rides on (price-chars 12 ...), not on the value. At the data boundary
\\ you would call (assert-bounded Price (price-chars) 12) once, after which
\\ every downstream render is statically safe.

(define price-cell
  Price -> [text-node (bounded-text Price (price-chars) 12 (mk-font "monospace" 14) 110)])

\\ A right-aligned column of prices — exactly the table column the README
\\ promises can never break.

(define render-view
  -> [frame (mk-props9 140 0 "column" 6 12 "" "flex-end" 0 0)
      [(price-cell "0.00")
       (price-cell "42.50")
       (price-cell "1,299.00")
       (price-cell "9,999,999.99")]])
