import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { GenrePicker } from "../components/sw/GenrePicker";
import { GENRES } from "../lib/sw/catalog";

function Harness() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  return <GenrePicker selected={selected} onChange={setSelected} />;
}

describe("Studio genre picker preserves rapid selection", () => {
  it("keeps both subgenre taps within one React batch", () => {
    render(<Harness />);
    const group = GENRES[0]!;
    fireEvent.click(screen.getByRole("button", { name: `Развернуть ${group.name}` }));
    const first = screen.getByRole("checkbox", { name: group.subgenres[0]!.name });
    const second = screen.getByRole("checkbox", { name: group.subgenres[1]!.name });
    act(() => {
      fireEvent.click(first);
      fireEvent.click(second);
    });
    expect(first).toBeChecked();
    expect(second).toBeChecked();
  });
  it("applies a group toggle after a rapid subgenre tap without losing it", () => {
    render(<Harness />);
    const group = GENRES[0]!;
    const another = GENRES[1]!;
    fireEvent.click(screen.getByRole("button", { name: `Развернуть ${group.name}` }));
    const first = screen.getByRole("checkbox", { name: group.subgenres[0]!.name });
    act(() => {
      fireEvent.click(first);
      fireEvent.click(screen.getByRole("checkbox", { name: `Выбрать весь жанр ${another.name}` }));
    });
    expect(first).toBeChecked();
    expect(screen.getByText(new RegExp(`Выбрано ${1 + another.subgenres.length} из`))).toBeInTheDocument();
  });
});
