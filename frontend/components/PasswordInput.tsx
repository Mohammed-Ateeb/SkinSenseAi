'use client';
import { useState, type ReactNode, type ChangeEvent } from "react";

/**
 * Password field with a show/hide eye toggle.
 *
 * Used on login (one field) and signup (password + confirm), so the toggle
 * lives here rather than being repeated three times.
 *
 * Notes:
 *  - type="button" on the toggle, otherwise it submits the form.
 *  - The right padding is set inline, not as a Tailwind class: the callers
 *    already pass px-4 / pl-10, and two competing padding utilities resolve by
 *    stylesheet order rather than class order, so the button could end up
 *    sitting on top of the text.
 *  - Each instance keeps its own visibility state, so revealing the password
 *    does not reveal the confirm field.
 */
export default function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  required = true,
  className = "",
  leftIcon = null,
  id,
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  className?: string;
  leftIcon?: ReactNode;
  id?: string;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      {leftIcon}
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={className}
        style={{ paddingRight: "2.75rem" }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        title={show ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md transition-opacity hover:opacity-100"
        style={{ background: "transparent", cursor: "pointer", opacity: 0.55, lineHeight: 0 }}
      >
        {show ? (
          // eye with a slash — currently visible, click to hide
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M2 10s3-5.5 8-5.5c1.2 0 2.3.3 3.2.8M18 10s-3 5.5-8 5.5c-1.2 0-2.3-.3-3.2-.8"
              stroke="#A89080" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="10" cy="10" r="2.4" stroke="#A89080" strokeWidth="1.3" />
            <path d="M3.5 3.5l13 13" stroke="#A89080" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ) : (
          // plain eye — currently hidden, click to show
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M2 10s3-5.5 8-5.5 8 5.5 8 5.5-3 5.5-8 5.5S2 10 2 10z"
              stroke="#A89080" strokeWidth="1.3" strokeLinejoin="round" />
            <circle cx="10" cy="10" r="2.4" stroke="#A89080" strokeWidth="1.3" />
          </svg>
        )}
      </button>
    </div>
  );
}
