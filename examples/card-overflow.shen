\\ card-overflow.shen — Deliberately broken card (demo: compile-time error)
\\
\\ This file demonstrates Witness catching layout overflow at load time.
\\ The title is too long for the 268px content area.
\\
\\ Run: witness dev examples/card-overflow.shen
\\ Expected: "Layout overflow: 'A Very Long Card Title That Will Definitely Overflow'..."

\\ This assertion will FAIL at load time — the title exceeds 268px
(assert-fits "A Very Long Card Title That Will Definitely Overflow" (mk-font "sans-serif" 18) 268)

(define render-view
  -> [frame (mk-props9 300 0 "column" 16 16 "" "" 0 0)
      [[text-node (proven-text "A Very Long Card Title That Will Definitely Overflow"
                               (mk-font "sans-serif" 18) 268)]]])
