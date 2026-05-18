"""
Color spec for the Claude Code agent state applet.

Maps Claude Code hook events to ball colors on the Cinnamon panel.
Each test is a concrete sequence of hook events with the expected color
asserted inline at every step.

Color reference:
  GRAY   = initialized          (session just registered, no activity yet)
  YELLOW = working              (agent is active: thinking, calling tools, writing response)
  BLUE   = asking_user          (agent used AskUserQuestion — waiting for typed input)
  GREEN  = done                 (turn finished — waiting for next user message)
  RED    = waiting_for_approval (notification fired — needs human attention / approval)
"""

# ---------------------------------------------------------------------------
# Constants — must stay in sync with applet.js STATE_COLOR and
#             state-report.py HOOK_TO_STATE / ASK_USER_TOOLS
# ---------------------------------------------------------------------------
GRAY   = "#888888"
YELLOW = "#e8c000"
BLUE   = "#4499ff"
GREEN  = "#44bb44"
RED    = "#ff2222"

_COLOR_NAME = {
    GRAY:   "gray/initialized",
    YELLOW: "yellow/working",
    BLUE:   "blue/asking_user",
    GREEN:  "green/done",
    RED:    "red/waiting_for_approval",
}

HOOK_TO_STATE = {
    "SessionStart":     "initialized",
    "UserPromptSubmit": "working",
    "PreToolUse":       "working",
    "PostToolUse":      "working",
    "Notification":     "waiting_for_approval",
    "Stop":             "done",
    "SubagentStop":     "working",
}
ASK_USER_TOOLS = {"AskUserQuestion", "AskUserQuestions"}
STATE_TO_COLOR = {
    "initialized":          GRAY,
    "working":              YELLOW,
    "asking_user":          BLUE,
    "done":                 GREEN,
    "waiting_for_approval": RED,
}


# ---------------------------------------------------------------------------
# Session — fluent builder: each step fires a hook event AND asserts the color
# ---------------------------------------------------------------------------
class Session:
    """Simulates the state machine driven by Claude Code hook events."""

    def __init__(self):
        self.state = "initialized"

    def _fire(self, event, tool_name=""):
        state = HOOK_TO_STATE.get(event, "initialized")
        if event == "PreToolUse" and tool_name in ASK_USER_TOOLS:
            state = "asking_user"
        self.state = state
        return self

    def _expect(self, expected_color):
        actual = STATE_TO_COLOR[self.state]
        assert actual == expected_color, (
            f"after state='{self.state}': "
            f"expected {_COLOR_NAME.get(expected_color, expected_color)}, "
            f"got {_COLOR_NAME.get(actual, actual)}"
        )
        return self

    def whenSessionStartsTheColorIs(self, color):
        return self._fire("SessionStart")._expect(color)

    def whenUserSubmitsMessageTheColorIs(self, color):
        return self._fire("UserPromptSubmit")._expect(color)

    def whenAgentCallsToolTheColorIs(self, color, tool="Bash"):
        return self._fire("PreToolUse", tool)._expect(color)

    def whenToolFinishesTheColorIs(self, color):
        return self._fire("PostToolUse")._expect(color)

    def whenAgentFinishesTurnTheColorIs(self, color):
        return self._fire("Stop")._expect(color)

    def whenAgentAsksUserTheColorIs(self, color):
        return self._fire("PreToolUse", "AskUserQuestion")._expect(color)

    def whenSubagentFinishesTheColorIs(self, color):
        return self._fire("SubagentStop")._expect(color)

    def whenApprovalNeededTheColorIs(self, color):
        return self._fire("Notification")._expect(color)


def given():
    return Session()


# ---------------------------------------------------------------------------
# Scenario 1: simple answer, no tools
#
#   User types message
#   └─ [agent thinks and generates response]          YELLOW
#   Stop fires
#   └─ agent finished, waiting for next message       GREEN
# ---------------------------------------------------------------------------
class TestSimpleAnswer:

    def test_basic_qa(self):
        (given()
            .whenUserSubmitsMessageTheColorIs(YELLOW)
            .whenAgentFinishesTurnTheColorIs(GREEN))

    def test_back_to_back_messages(self):
        (given()
            .whenUserSubmitsMessageTheColorIs(YELLOW)
            .whenAgentFinishesTurnTheColorIs(GREEN)
            .whenUserSubmitsMessageTheColorIs(YELLOW)   # new turn, yellow again
            .whenAgentFinishesTurnTheColorIs(GREEN))


# ---------------------------------------------------------------------------
# Scenario 2: tool calls
#
#   User types message
#   └─ [agent thinks]                                 YELLOW
#   PreToolUse(Bash) fires
#   └─ tool is running                                YELLOW
#   PostToolUse fires
#   └─ [agent processes result, writes response]      YELLOW  ← key invariant
#   Stop fires
#   └─ done                                           GREEN
# ---------------------------------------------------------------------------
class TestToolCalls:

    def test_single_tool(self):
        (given()
            .whenUserSubmitsMessageTheColorIs(YELLOW)
            .whenAgentCallsToolTheColorIs(YELLOW)
            .whenToolFinishesTheColorIs(YELLOW)
            .whenAgentFinishesTurnTheColorIs(GREEN))

    def test_multiple_tools_in_sequence(self):
        """Read → Edit → Bash, then answer."""
        (given()
            .whenUserSubmitsMessageTheColorIs(YELLOW)
            .whenAgentCallsToolTheColorIs(YELLOW, tool="Read")
            .whenToolFinishesTheColorIs(YELLOW)
            .whenAgentCallsToolTheColorIs(YELLOW, tool="Edit")
            .whenToolFinishesTheColorIs(YELLOW)
            .whenAgentCallsToolTheColorIs(YELLOW, tool="Bash")
            .whenToolFinishesTheColorIs(YELLOW)
            .whenAgentFinishesTurnTheColorIs(GREEN))

    def test_stays_yellow_while_composing_response_after_tool(self):
        """Between PostToolUse and Stop the agent is writing its final answer.
        No hook fires in that gap, so the last-set state (working) must be YELLOW."""
        s = given()
        s._fire("UserPromptSubmit")
        s._fire("PreToolUse", "Bash")
        s._fire("PostToolUse")
        # gap: agent is generating response — no hook fires
        assert s.state == "working",                "gap state must be 'working'"
        assert STATE_TO_COLOR[s.state] == YELLOW,   "gap color must be yellow"
        s._fire("Stop")
        assert STATE_TO_COLOR[s.state] == GREEN,    "after Stop must be green"


# ---------------------------------------------------------------------------
# Scenario 3: agent asks the user a question  (AskUserQuestion tool)
#
#   PreToolUse(AskUserQuestion) fires
#   └─ agent is waiting for typed answer              BLUE
#   PostToolUse fires (user answered)
#   └─ back to generating response                    YELLOW
#   Stop fires
#   └─ done                                           GREEN
# ---------------------------------------------------------------------------
class TestAskingUser:

    def test_agent_asks_then_continues(self):
        (given()
            .whenUserSubmitsMessageTheColorIs(YELLOW)
            .whenAgentAsksUserTheColorIs(BLUE)
            .whenToolFinishesTheColorIs(YELLOW)
            .whenAgentFinishesTurnTheColorIs(GREEN))

    def test_asking_user_is_not_working_and_not_done(self):
        s = given()
        s._fire("UserPromptSubmit")
        s._fire("PreToolUse", "AskUserQuestion")
        assert s.state == "asking_user"
        assert STATE_TO_COLOR[s.state] == BLUE
        assert STATE_TO_COLOR[s.state] != YELLOW,  "blue ≠ yellow: user attention needed"
        assert STATE_TO_COLOR[s.state] != GREEN,   "blue ≠ green: not done yet"


# ---------------------------------------------------------------------------
# Scenario 4: approval / notification
#
#   Notification fires (e.g. agent surfaced a dangerous command)
#   └─ waiting for human to act                       RED
#   Stop fires
#   └─ done                                           GREEN
# ---------------------------------------------------------------------------
class TestApproval:

    def test_notification_shows_red(self):
        (given()
            .whenUserSubmitsMessageTheColorIs(YELLOW)
            .whenAgentCallsToolTheColorIs(YELLOW)
            .whenApprovalNeededTheColorIs(RED)
            .whenAgentFinishesTurnTheColorIs(GREEN))

    def test_notification_is_not_done(self):
        s = given()
        s._fire("Notification")
        assert STATE_TO_COLOR[s.state] == RED
        assert STATE_TO_COLOR[s.state] != GREEN,   "red ≠ green: agent hasn't finished yet"


# ---------------------------------------------------------------------------
# Scenario 5: subagents
#
#   Agent spawns a subagent (Task tool)
#   SubagentStop fires when the subagent finishes
#   └─ parent agent is still running                  YELLOW
#   Stop fires (parent finishes)
#   └─ done                                           GREEN
# ---------------------------------------------------------------------------
class TestSubagents:

    def test_subagent_finish_keeps_parent_yellow(self):
        (given()
            .whenUserSubmitsMessageTheColorIs(YELLOW)
            .whenAgentCallsToolTheColorIs(YELLOW, tool="Task")
            .whenSubagentFinishesTheColorIs(YELLOW)     # parent still running
            .whenAgentFinishesTurnTheColorIs(GREEN))

    def test_multiple_subagents(self):
        (given()
            .whenUserSubmitsMessageTheColorIs(YELLOW)
            .whenAgentCallsToolTheColorIs(YELLOW, tool="Task")
            .whenSubagentFinishesTheColorIs(YELLOW)
            .whenAgentCallsToolTheColorIs(YELLOW, tool="Task")
            .whenSubagentFinishesTheColorIs(YELLOW)
            .whenAgentFinishesTurnTheColorIs(GREEN))


# ---------------------------------------------------------------------------
# Scenario 6: full lifecycle
# ---------------------------------------------------------------------------
class TestSessionLifecycle:

    def test_session_start_is_gray(self):
        given().whenSessionStartsTheColorIs(GRAY)

    def test_gray_only_before_first_message(self):
        s = given()
        s._fire("SessionStart")
        assert STATE_TO_COLOR[s.state] == GRAY
        s._fire("UserPromptSubmit")
        assert STATE_TO_COLOR[s.state] == YELLOW,  "first message must turn yellow immediately"

    def test_realistic_multi_turn_session(self):
        """Session start → two turns, second with a user question."""
        (given()
            .whenSessionStartsTheColorIs(GRAY)
            # turn 1: bash script, then answer
            .whenUserSubmitsMessageTheColorIs(YELLOW)
            .whenAgentCallsToolTheColorIs(YELLOW, tool="Bash")
            .whenToolFinishesTheColorIs(YELLOW)
            .whenAgentFinishesTurnTheColorIs(GREEN)
            # turn 2: reads file, asks user, continues, done
            .whenUserSubmitsMessageTheColorIs(YELLOW)
            .whenAgentCallsToolTheColorIs(YELLOW, tool="Read")
            .whenToolFinishesTheColorIs(YELLOW)
            .whenAgentAsksUserTheColorIs(BLUE)
            .whenToolFinishesTheColorIs(YELLOW)
            .whenAgentFinishesTurnTheColorIs(GREEN))
