package com.github.agentfocus

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.wm.ToolWindowManager
import io.netty.channel.ChannelHandlerContext
import io.netty.handler.codec.http.FullHttpRequest
import io.netty.handler.codec.http.QueryStringDecoder
import org.jetbrains.ide.RestService

class TerminalRenameService : RestService() {

    override fun getServiceName() = "terminalRename"

    override fun execute(
        urlDecoder: QueryStringDecoder,
        request: FullHttpRequest,
        context: ChannelHandlerContext
    ): String? {
        val params = urlDecoder.parameters()
        val newName = params["newName"]?.firstOrNull() ?: return "Missing newName"
        val projectName = params["project"]?.firstOrNull()

        val project = ProjectManager.getInstance().openProjects
            .firstOrNull { projectName == null || it.name == projectName }
            ?: return "No open project"

        ApplicationManager.getApplication().invokeLater {
            val toolWindow = ToolWindowManager.getInstance(project)
                .getToolWindow("Terminal") ?: return@invokeLater
            val content = toolWindow.contentManager.selectedContent ?: return@invokeLater
            content.displayName = newName
        }

        sendOk(request, context)
        return null
    }
}
