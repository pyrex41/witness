\\ examples/shake/proof.shen — a Witness layout proof, distilled to pure Shen.
\\
\\ The thing the README calls "erases after compilation": once text has been
\\ measured at build time (by Pretext), the PROOF that it fits its container is
\\ pure arithmetic over a cached measurement table — no canvas, no Yoga, no FFI.
\\ ratatoskr tree-shakes that pure core to a minimal standalone kernel slice;
\\ bifrost verifies it runs identically on every Shen port. Mirrors
\\ shen/proofs.shen's measure / fits? / assert-fits (the cache-backed SBCL path).
\\
\\ Everything is a (define) plus a single (proof) call at the end, so no
\\ top-level expression value leaks into a port's REPL echo.

(define measurements
  -> [["Card Title"   "18px sans-serif" 77]
      ["View Details" "14px sans-serif" 77]
      ["Save"         "14px sans-serif" 32]])

(define lookup
  Text Font [[Text Font W] | _] -> W
  Text Font [_ | Rest] -> (lookup Text Font Rest)
  Text Font [] -> (simple-error "no cached measurement"))

(define measure
  Text Font -> (lookup Text Font (measurements)))

(define fits?
  Text Font MaxW -> (<= (measure Text Font) MaxW))

(define assert-fits
  Text Font MaxW ->
    (if (fits? Text Font MaxW)
        (output "PROVEN   ~A fits ~A in ~Apx~%" Text Font MaxW)
        (output "OVERFLOW ~A is ~Apx, container ~Apx~%"
                Text (measure Text Font) MaxW)))

(define pass
  -> (do (assert-fits "Card Title"   "18px sans-serif" 268)
         (assert-fits "Save"         "14px sans-serif" 120)
         (assert-fits "View Details" "14px sans-serif" 60)))

(define proof
  -> (do (pass) (output "===~%") (pass)))

(proof)
