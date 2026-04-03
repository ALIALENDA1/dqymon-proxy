/**
 * DialogBuilder — Fluent builder for Growtopia dialog DSL strings.
 *
 * Usage:
 *   const dlg = new DialogBuilder("my_dialog")
 *     .addLabelBig("Hello!")
 *     .addSpacer()
 *     .addSmallText("Pick an option:")
 *     .addButtonWithIcon("btn_warp", "Warp", 3002, "staticBlueFrame")
 *     .endDialog("close", "Cancel", "")
 *     .build();
 *
 * The resulting string is passed to OnDialogRequest to show the dialog.
 */
class DialogBuilder {
  constructor(dialogName) {
    this.dialogName = dialogName;
    this.lines = [];
    this.embedData = null;
  }

  /** Set the default color for the dialog. */
  setDefaultColor(color) {
    this.lines.push(`set_default_color|${color}`);
    return this;
  }

  /** Add a big label with an icon. */
  addLabelBig(text, iconID = 0) {
    if (iconID > 0) {
      this.lines.push(`add_label_with_icon|big|${text}|left|${iconID}|`);
    } else {
      this.lines.push(`add_label|big|${text}|`);
    }
    return this;
  }

  /** Add a small label with optional icon. */
  addLabelSmall(text, iconID = 0) {
    if (iconID > 0) {
      this.lines.push(`add_label_with_icon|small|${text}|left|${iconID}|`);
    } else {
      this.lines.push(`add_label|small|${text}|`);
    }
    return this;
  }

  /** Add small text (alias for addLabelSmall). */
  addSmallText(text) {
    this.lines.push(`add_smalltext|${text}|`);
    return this;
  }

  /** Add a spacer line. */
  addSpacer(small = false) {
    this.lines.push(small ? "add_spacer|small|" : "add_spacer|big|");
    return this;
  }

  /** Add a text input field. */
  addTextInput(id, label, defaultValue = "", maxLen = 30) {
    this.lines.push(`add_text_input|${id}|${label}|${defaultValue}|${maxLen}|`);
    return this;
  }

  /** Add a button. */
  addButton(id, text, noWrap = false) {
    if (noWrap) {
      this.lines.push(`add_button|${id}|${text}|noflags|0|0|`);
    } else {
      this.lines.push(`add_button|${id}|${text}|`);
    }
    return this;
  }

  /** Add a button with an icon. */
  addButtonWithIcon(id, text, iconID, frameStyle = "staticBlueFrame") {
    this.lines.push(`add_button_with_icon|${id}|${text}|${frameStyle}|${iconID}|`);
    return this;
  }

  /** Add a checkbox. */
  addCheckbox(id, label, checked = false) {
    this.lines.push(`add_checkbox|${id}|${label}|${checked ? 1 : 0}`);
    return this;
  }

  /** Add a custom raw line. */
  addRaw(line) {
    this.lines.push(line);
    return this;
  }

  /** Add a URL button. */
  addURL(url, label, spriteID = 0) {
    this.lines.push(`add_url_button||${label}|NOFLAGS|${url}|${label}|${spriteID}|`);
    return this;
  }

  /** Add an item picker. */
  addItemPicker(id, label, headerText = "Choose an item") {
    this.lines.push(`add_item_picker|${id}|${label}|${headerText}|`);
    return this;
  }

  /** Set embed data (arbitrary data to pass back in dialog_return). */
  setEmbedData(data) {
    this.embedData = data;
    return this;
  }

  /**
   * End the dialog with OK/Cancel buttons.
   * @param {string} submitId - The button ID for submit
   * @param {string} cancelText - Text for cancel button ("" to hide)
   * @param {string} okText - Text for OK button ("" to hide)
   */
  endDialog(submitId, cancelText, okText) {
    this.lines.push(`end_dialog|${submitId}|${cancelText}|${okText}|`);
    return this;
  }

  /** Build the dialog string. */
  build() {
    let result = `set_custom_spacing|x:0;y:-4|\n`;
    if (this.embedData) {
      result += `embed_data|${this.dialogName}|${this.embedData}\n`;
    }
    result += this.lines.join("\n");
    return result;
  }

  /** Get the dialog name. */
  getName() {
    return this.dialogName;
  }
}

module.exports = DialogBuilder;
