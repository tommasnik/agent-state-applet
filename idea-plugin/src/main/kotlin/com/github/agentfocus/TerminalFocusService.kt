package com.github.agentfocus

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.wm.ToolWindowManager
import io.netty.channel.ChannelHandlerContext
import io.netty.handler.codec.http.FullHttpRequest
import io.netty.handler.codec.http.QueryStringDecoder
import org.jetbrains.ide.RestService

class TerminalFocusService : RestService() {

    override fun getServiceName() = "terminalFocus"

    override fun execute(
        urlDecoder: QueryStringDecoder,
        request: FullHttpRequest,
        context: ChannelHandlerContext
    ): String? {
        val params = urlDecoder.parameters()
        val tabName = params["tabName"]?.firstOrNull() ?: return "Missing tabName"
        val newName = params["newName"]?.firstOrNull()
        val projectName = params["project"]?.firstOrNull()

        val project = ProjectManager.getInstance().openProjects
            .firstOrNull { projectName == null || it.name == projectName }
            ?: return "No open project"

        ApplicationManager.getApplication().invokeLater {
            val toolWindow = ToolWindowManager.getInstance(project)
                .getToolWindow("Terminal") ?: return@invokeLater
            // Primary: match by stable user-data tag (survives any displayName rename).
            // Fallbacks: displayName == tabName, then displayName == newName (AI title).
            val content = toolWindow.contentManager.contents
                .firstOrNull { it.getUserData(CC_TAB_KEY) == tabName }
                ?: toolWindow.contentManager.contents
                    .firstOrNull { it.displayName == tabName }
                ?: toolWindow.contentManager.contents
                    .firstOrNull { newName != null && it.displayName == newName }
                ?: return@invokeLater

            if (!toolWindow.isVisible) toolWindow.show()
            toolWindow.contentManager.setSelectedContent(content, true)
            if (newName != null) content.displayName = newName
        }

        sendOk(request, context)
        return null
    }
}
