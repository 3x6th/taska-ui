import { useId } from "react";
import { useOutletContext } from "react-router-dom";
import { usePreference } from "../../hooks/usePreference";
import type { Theme } from "../../hooks/useTheme";
import { boardColumnsPreference, issueDetailsPreference } from "../../lib/readerPrefs";
import type { SettingsOutletContext } from "./sections";

/**
 * Settings → Appearance (TAS-380, art-director's ruling 5): three choices of
 * how the product is drawn for this reader, in this browser. A change applies
 * the moment it is pressed and is remembered with it — no Save, no toast, no
 * "Saved" (§5.9). Where each one lives is `src/lib/readerPrefs.ts`; the theme is
 * the app's one theme state, the same the top bar's toggle switches.
 *
 * On a phone (≤820) neither layout choice has an effect — issues always open
 * from the side and columns start at the left — and the page says so in a line
 * only that width shows. The controls stay enabled: the choice is still the
 * reader's, and it applies on a wider screen.
 */
export function SettingsAppearanceSection() {
  const { theme, setTheme } = useOutletContext<SettingsOutletContext>();
  const [issueDetails, setIssueDetails] = usePreference(issueDetailsPreference);
  const [boardColumns, setBoardColumns] = usePreference(boardColumnsPreference);
  const rowId = useId();

  /**
   * One row: a title, a description, and the segmented control that answers
   * it. A plain function rather than a component of its own — it holds no
   * state and is used only here.
   */
  const row = <T extends string>(
    id: string,
    title: string,
    description: string,
    options: readonly { value: T; label: string }[],
    value: T,
    choose: (value: T) => void,
  ) => (
    <li className="settings-row" key={id}>
      <div className="settings-row-text">
        <h2 className="settings-row-title" id={`${rowId}-${id}-title`}>
          {title}
        </h2>
        <p className="settings-row-description" id={`${rowId}-${id}-description`}>
          {description}
        </p>
      </div>
      {/* `aria-pressed`, the product's segmented convention since TAS-299:
          the current option is otherwise said only by its fill. Pressing the
          selected one does nothing. */}
      <div
        aria-describedby={`${rowId}-${id}-description`}
        aria-labelledby={`${rowId}-${id}-title`}
        className="segmented fit"
        role="group"
      >
        {options.map((option) => (
          <button
            aria-pressed={value === option.value}
            className={value === option.value ? "is-active" : ""}
            key={option.value}
            onClick={() => {
              if (value !== option.value) choose(option.value);
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </li>
  );

  return (
    <div className="settings-plane">
      <div className="settings-column">
        <p className="settings-lead">These choices are saved in this browser.</p>
        <p className="settings-phone-note">
          On a phone, issues always open from the side and columns start at the left.
        </p>
        <ul className="settings-rows">
          {row(
            "issue-details",
            "Issue details",
            "Where an issue opens when you select it on the board.",
            [
              { value: "side", label: "Side panel" },
              { value: "centered", label: "Centered window" },
            ],
            issueDetails,
            setIssueDetails,
          )}
          {row(
            "board-columns",
            "Board columns",
            "Where the columns sit on a wide screen.",
            [
              { value: "left", label: "Left" },
              { value: "centered", label: "Centered" },
            ],
            boardColumns,
            setBoardColumns,
          )}
          {row<Theme>(
            "theme",
            "Theme",
            "Also switched with the button in the top bar.",
            [
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ],
            theme,
            setTheme,
          )}
        </ul>
      </div>
    </div>
  );
}
