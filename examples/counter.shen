\\ counter.shen — Complete counter app from Witness spec
\\
\\ Demonstrates:
\\   - TEA (The Elm Architecture) with typed messages and model
\\   - Layout proof: static button labels checked at compile time via proven-text
\\   - handled-text for dynamic counter display (overflow = visible)
\\   - Tailwind-style layout classes
\\
\\ Model = (@p count N) where N is a number
\\ Messages = increment | decrement

\\ --- Static text proofs (Tier 1: checked at load time) ---
\\ Compiler verifies these fit at file-load time (~1ms)
\\ measure("-", Inter 14) = 7px.  7 <= 96 OK
\\ measure("+", Inter 14) = 11px. 11 <= 96 OK

(assert-fits "-" (mk-font "Inter" 14) 96)
(assert-fits "+" (mk-font "Inter" 14) 96)

\\ --- Init ---

(define counter-init
  _ -> (@p (@p count 0) cmd-none))

\\ --- Update ---

(define counter-update
  increment (@p count N) -> (@p (@p count (+ N 1)) cmd-none)
  decrement (@p count N) -> (@p (@p count (- N 1)) cmd-none)
  _ M -> (@p M cmd-none))

\\ --- View: layout proofs checked at compile time ---
\\ The tw macro builds [frame Props Children] nodes.
\\ text-node wraps safe-text (proven-text or handled-text) into node.
\\ Dynamic counter value uses handled-text with visible overflow.

(define counter-view
  (@p count N) ->
    (tw [flex flex-col items-center gap-4 p-8]
      [(text-node (handled-text (str N) (mk-font "Inter" 32) visible))
       (tw [flex gap-2]
         [(counter-button "-" decrement)
          (counter-button "+" increment)])]))

\\ Button with proven-text: the assert-fits calls above guarantee
\\ "-" and "+" fit in 96px at Inter 14. proven-text makes this
\\ a type-level contract.
(define counter-button
  Label Msg ->
    (tw [px-4 py-2 rounded-lg text-sm font-medium]
      [(text-node (proven-text Label (mk-font "Inter" 14) 96))]))

\\ --- Run the app (requires DOM; omitted for CLI checking) ---
\\ (run-app (mk-app counter-init counter-update counter-view (/. _ sub-none))
\\   unit
\\   (dom-renderer "root"))
