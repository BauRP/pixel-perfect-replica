import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HelpDot } from "../components/sw/ui";

afterEach(() => cleanup());

describe("Studio compact question-mark help on Android WebView", () => {
  it("has a 22px outlined circle with a white ? and a 44px touch target", () => {
    render(<HelpDot title="Настроение" text="Влево: грустнее. Вправо: веселее." />);
    const button=screen.getByRole("button",{name:"Что такое «Настроение»?"});
    const sign=button.querySelector(".sw-help-mark") as HTMLElement;
    expect(sign.textContent).toBe("?");
    expect(sign.style.width).toBe("22px");
    expect(sign.style.height).toBe("22px");
    expect(sign.style.background).toBe("transparent");
    expect(["#ffffff","rgb(255, 255, 255)"]).toContain(sign.style.color);
    expect(["#ffffff","rgb(255, 255, 255)"]).toContain(sign.style.borderColor);
    expect(button.style.width).toBe("44px");
    expect(button.style.height).toBe("44px");
  });

  it("click opens the readable compact dialog and X closes it",()=>{
    render(<HelpDot title="Настроение" text="Влево: грустнее. Вправо: веселее." />);
    const button=screen.getByRole("button",{name:"Что такое «Настроение»?"});
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog",{name:"Настроение"})).toBeTruthy();
    expect(screen.getByText("Влево: грустнее. Вправо: веселее.")).toBeTruthy();
    expect(screen.getByText(/Нов(ая|ой) музык/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Закрыть подсказку"}));
    expect(screen.queryByRole("dialog",{name:"Настроение"})).toBeNull();
  });

  it("Android touchend opens the dialog without being closed by synthetic click",()=>{
    render(<HelpDot title="Скорость музыки" text="Влево: медленнее. Вправо: быстрее." />);
    const button=screen.getByRole("button",{name:"Что такое «Скорость музыки»?"});
    fireEvent.touchStart(button,{touches:[{clientX:15,clientY:15}]});
    fireEvent.touchEnd(button,{changedTouches:[{clientX:16,clientY:15}]});
    expect(screen.getByRole("dialog",{name:"Скорость музыки"})).toBeTruthy();
    fireEvent.click(button);
    expect(screen.getByRole("dialog",{name:"Скорость музыки"})).toBeTruthy();
  });

  it("tap outside closes and keyboard Escape closes",()=>{
    render(<HelpDot title="Насколько музыка реагирует на мир" text="Слабо, средне, сильно" />);
    const button=screen.getByRole("button",{name:"Что такое «Насколько музыка реагирует на мир»?"});
    fireEvent.click(button);
    fireEvent.click(screen.getByTestId("sw-help-overlay"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button);
    fireEvent.keyDown(document,{key:"Escape"});
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
