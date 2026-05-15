package com.github.agentfocus

import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.wm.ToolWindowManager
import io.netty.buffer.Unpooled
import io.netty.channel.ChannelHandlerContext
import io.netty.handler.codec.http.DefaultFullHttpResponse
import io.netty.handler.codec.http.FullHttpRequest
import io.netty.handler.codec.http.HttpHeaderNames
import io.netty.handler.codec.http.HttpResponseStatus
import io.netty.handler.codec.http.HttpVersion
import io.netty.handler.codec.http.QueryStringDecoder
import org.jetbrains.ide.RestService

class TerminalListService : RestService() {

    override fun getServiceName() = "terminalList"

    override fun execute(
        urlDecoder: QueryStringDecoder,
        request: FullHttpRequest,
        context: ChannelHandlerContext
    ): String? {
        val projects = ProjectManager.getInstance().openProjects.map { project ->
            val tabs = ToolWindowManager.getInstance(project)
                .getToolWindow("Terminal")
                ?.contentManager?.contents
                ?.map { "\"${it.displayName.replace("\"", "\\\"")}\"" }
                ?: emptyList()
            """{"project":"${project.name}","tabs":[${tabs.joinToString(",")}]}"""
        }
        val json = """{"projects":[${projects.joinToString(",")}]}"""

        val bytes = json.toByteArray(Charsets.UTF_8)
        val response = DefaultFullHttpResponse(
            HttpVersion.HTTP_1_1,
            HttpResponseStatus.OK,
            Unpooled.wrappedBuffer(bytes)
        )
        response.headers().set(HttpHeaderNames.CONTENT_TYPE, "application/json; charset=utf-8")
        response.headers().set(HttpHeaderNames.CONTENT_LENGTH, bytes.size)
        sendResponse(request, context, response)
        return null
    }
}
