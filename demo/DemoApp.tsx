"use client";
import GrantsApp from "../components/GrantsApp";
import { demoMode } from "./mode";

export default function DemoApp() { return <GrantsApp mode={demoMode} />; }
