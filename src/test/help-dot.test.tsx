import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HelpDot } from "../components/sw/ui";

afterEach(() => cleanup());

describe("Studio question-mark help on Android WebView", () => {
  it("shows a real white ? in an unfilled circle and opens an anchored explanation", () => {
    render(<HelpDot title="Настроение" text="Выбирает грустное или весёлое звучание" />);
    const button = screen.getByRole("button", { name: "Что такое «Настроение»?" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const sign = button.querySelector(".sw-help-mark") as HTMLElement;
    expect(sign?.textContent).toBe("?");
    expect(sign.style.background).toBe("transparent");
    expect(["#ffffff", "rgb(255, 255, 255)"]).toContain(sign.style.color);
    expect(["#ffffff", "rgb(255, 255, 255)"]).toContain(sign.style.borderColor);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Настроение" })).toBeTruthy();
    expect(screen.getByText("Выбирает грустное или весёлое звучание")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть подсказку" }));
    expect(screen.queryByRole("dialog", { name: "Настроение" })).toBeNull();
  });

  it("closes on an outside tap and supports another setting independently", () => {
    render(<HelpDot title="Скорость музыки" text="Меняет темп новой композиции" />);
    const button = screen.getByRole("button", { name: "Что такое «Скорость музыки»?" });
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Скорость музыки" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Скорость музыки" })).toBeNull();
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Скорость музыки" })).toBeNull();
  });
});
