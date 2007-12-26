function GameUpdater(url)
{
	function GameUpdaterException(msg)
	{
			this.message = msg;
	}

	this.url = url || null;
	
	// Where to look for version information.
	// This can be safely changed as long as it is always consistent.
	this.versionFile = "version";
		
	// Progress callback. Hook into this to receive feedback from the updater.
	// (int progress, string working_on) => void
	this.onProgress = null;	
	
	// On version corrupt. Return true if you want the updater to simply update the entire game, false to fail.
	// () => bool
	this.onVersionCorrupt = null;
	
	// On new version available. Return true to download it, false to exit.
	// ({version, disp_version} version) => bool
	this.onVersionAvailable = null;
	
	// Attempt to update our copy.
	this.update = function()
	{
	
		var localVersionFile = OpenRawFile(this.versionFile);
		var localVersionData = CreateStringFromByteArray(localVersionFile.read(localVersionFile.getSize())).split(/\r?\n/);
		localVersionFile.close();
		
		var localVersionInfo = {};
		
		for (var i = 0; i < localVersionData.length; i++)
		{
			localVersionInfo[localVersionData[i].substr(0, localVersionData[i].indexOf("="))] = localVersionData[i].substr(localVersionData[i].indexOf("=") + 1);
		}
	
		if (!localVersionInfo['version'] || !localVersionInfo['dispVersion'])
		{
			// The version data seems to be missing.
			// Assume our copy is corrupt.
			if (this.onVersionCorrupt && this.onVersionCorrupt())
			{
				// Update the entire game.
				localVersionInfo['version'] = -1;
				localVersionInfo['dispversion'] = "";
			}
			else
			{
				// Error. The user can catch this if they want to continue anyway.
				throw new GameUpdaterException("Game version is corrupted.");
			}
		}
		else
		{
			// Clean up the vars.
			localVersionInfo['version'] = parseInt(localVersionInfo['version']);
		}
	
		this.onProgress && this.onProgress(0, "Checking remote version");
	
		// Find out what the available version is from the server.
		remoteVersionInfo = getRemoteVersionInfo();
		if (remoteVersionInfo['version'] > localVersionInfo['version'])
		{
			if (this.onVersionAvailable && this.onVersionAvailable(remoteVersionInfo))
			{
				performUpdate();
			}
			else
			{
				// No checks, always update.
				if (!this.onVersionAvailable)
				{
					performUpdate();
				}
				else
				{
					return false;
				}
			}
		}
		else
		{
			return true;
		}
	}
	
	function fileExists(file)
	{
		// TODO: implement this
		return false;
	}
	
	function performUpdate()
	{
		// Get the hashes, so we know what files need updating.
		var hashes = getHashes();
		
		// Check all our local files
		var requires_update = [];
		for (var file in hashes)
		{
			if (fileExists(file))
			{
				var localHash = HashFromFile("../" + file);
				if (hashes[file] != localHash)
					requires_update.push(file);
			}
			else
			{
				requires_update.push(file);
			}
		}
		
	}
	
	function getHashes()
	{
		try
		{
			var request = new HttpRequest(url + "/get/hashes", "GET");
			request.send();
			var hashesData = CreateStringFromByteArray(request.readAll()).split(/\r?\n/);
			request.close();
		}
		catch (e)
		{
			throw new GameUpdaterException("Unable to request hashes resource.\n");
		}

		var hashesInfo = {};
		for (var i = 0; i < hashesData.length; i++)
		{
			hashesInfo[hashesData[i].substr(0, hashesData[i].lastIndexOf(" "))] = hashesData[i].substr(hashesData[i].lastIndexOf(" ") + 1);
		}
		return hashesInfo;
	}
	
	function getRemoteVersionInfo()
	{
		try
		{
			var request = new HttpRequest(url + "/get/version", "GET");
			request.send();
			var remoteVersionData = CreateStringFromByteArray(request.readAll()).split(/\r?\n/);
			request.close();
		}
		catch (e)
		{
			throw new GameUpdaterException("Unable to request version resource.");
		}
				
		var remoteVersionInfo = {};
		
		for (var i = 0; i < remoteVersionData.length; i++)
		{
			remoteVersionInfo[remoteVersionData[i].substr(0, remoteVersionData[i].indexOf("="))] = remoteVersionData[i].substr(remoteVersionData[i].indexOf("=") + 1);
		}
		
		return remoteVersionInfo;
	}
	
	/*
	 * HttpRequest
	 * Performs a lightweight HTTP request.
	 */
	 
	function HttpRequest(uri, method)
	{
		function HttpRequestException(msg)
		{
			this.message = msg;
		}
		
		if (!uri) throw new HttpRequestException("No URI specified.");
	
		this.uri = uri;
		this.method = method || "GET";
		
		function getHostPart(uri)
		{
			return /^http:\/\/(.*?)(\:\d+)?\/.*$/(uri)[1];
		}
		
		function getPortPart(uri)
		{
			return /^http:\/\/(.*?)(\:(\d+))?\/.*$/(uri)[3] || null;
		}
		
		function getPathPart(uri)
		{
			return /^http:\/\/(.*?)(\/(.*))$/(uri)[2] || null;
		}
		
		this.send = function()
		{
			// build the headers
			var headers = [];
			
			headers.push(this.method.toUpperCase() + " " + getPathPart(this.uri) + " HTTP/1.1");
			headers.push("Host: " + getHostPart(this.uri));
			headers.push("Accept: text/plain");
			headers.push("Pragma: no-cache");
			headers.push("Cache-Control: no-cache");
			headers.push("Connection: close");
			headers.push("User-Agent: GameUpdater");
			
			this.socket = OpenAddress(getHostPart(this.uri), getPortPart(this.uri) || 80);
			if (!this.socket)
			{
				throw new HttpRequestException("Unable to open socket.");
			}
			this.socket.write(CreateByteArrayFromString(headers.join("\r\n") + "\r\n\r\n"));
		}
		
		this.readAll = function()
		{
			if (!this.socket.isConnected())
			{
				throw new HttpRequestException("No socket to read from.");
			}
			// Read the headers
			var header_data = "";
			while (header_data.indexOf("\r\n\r\n") == -1)
			{
				if (!this.socket.isConnected()) throw new HttpRequestException("Socket became disconnected during read.");
				header_data += CreateStringFromByteArray(this.socket.read(this.socket.getPendingReadSize()));
			}
			
			var extra_data = header_data.substr(header_data.indexOf("\r\n\r\n") + 4);
			var headers = header_data.substr(0, header_data.indexOf("\r\n\r\n")).split("\r\n");
			
			// If this was an error (400-599), fail.
			var status_code = parseInt(headers[0].split(" ")[1]);
			if (status_code >= 400 && status_code <= 599)
			{
				throw new HttpRequestException(headers[0]);
			}
			
			// If the server has sent content-length, we need to use that.
			var contentLength = -1;
			for (var i = 0; i < headers.length; i++)
			{
				var header_name = headers[i].substr(0, headers[i].indexOf(":"));
				var header_value = headers[i].substr(headers[i].indexOf(":") + 1);
				if (header_name.toLowerCase() == "content-length")
				{
					contentLength = parseInt(header_value);
				}
			}
			if (contentLength != -1)
			{
				return CreateByteArrayFromString(extra_data).concat(this.socket.read(contentLength));
			}
			else
			{
				var ba = CreateByteArrayFromString(extra_data);
				while (this.socket.isConnected())
				{
					ba = ba.concat(this.socket.read(this.socket.getPendingReadSize()));
				}
				return ba;
			}
		}
		
		this.close = function()
		{
			this.socket.close();
		}
	}
}